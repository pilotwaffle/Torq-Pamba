import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { publishAttempts, publishEvents, publishingConnections, socialPlatform, videos } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import { validateTargets } from "./accounts";
import { asPlatform, isPlatform, PLATFORMS, PLATFORM_MODES } from "./config";
import { sealToken } from "./crypto";
import { runPublishJob } from "./dispatch";

/**
 * CONTRIBUTING.md criterion 1: official TikTok, Instagram and Facebook APIs
 * only. No phone-farm, device, emulator or managed-account posting, and no
 * unofficial or private platform APIs.
 */

const ROOT = process.cwd();
const SELF = path.join("src", "lib", "publish", "compliance.test.ts");

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(ts|tsx|js|mjs|cjs|sh|json)$/.test(entry.name)) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

// Device, emulator and app-automation tooling, and unofficial/private-API clients.
const FORBIDDEN_PACKAGES = [
  "appium",
  "appium-adb",
  "appium-uiautomator2-driver",
  "appium-xcuitest-driver",
  "webdriverio",
  "wd",
  "selenium-webdriver",
  "puppeteer",
  "puppeteer-core",
  "puppeteer-extra",
  "playwright",
  "playwright-core",
  "@playwright/test",
  "adbkit",
  "@devicefarmer/adbkit",
  "node-adb",
  "adb-ts",
  "instagram-private-api",
  "instagrapi",
  "instagram-web-api",
  "tiktok-api",
  "tiktok-scraper",
  "tiktok-private-api",
  "@tobyg74/tiktok-api-dl",
  "facebook-chat-api",
];

// Code-level signatures: ADB and automation drivers, emulators, the platforms'
// private mobile APIs and request signing, their app packages, and scripted
// logins to the consumer sites (managed-account automation).
const FORBIDDEN_CODE: RegExp[] = [
  /\badb\s+(shell|-s|devices|install|push)\b/i,
  /\buiautomator2?\b/i,
  /\bXCUITest\b/i,
  /\/wd\/hub\b/i,
  /\bemulator-\d{4}\b/i,
  /\b(genymotion|bluestacks|avdmanager)\b/i,
  /\bi\.instagram\.com\b/i,
  /\binstagram\.com\/api\/v1\b/i,
  /\big_sig_key\b/i,
  /\bapi\d{1,2}-(normal|core)[-.]/i,
  /\bmusical\.ly\b/i,
  /\bX-(Gorgon|Argus|Ladon|Khronos)\b/i,
  /\bcom\.zhiliaoapp\.musically\b/,
  /\bcom\.ss\.android\.ugc\b/,
  /\bcom\.instagram\.android\b/,
  /\bcom\.facebook\.katana\b/,
  /\binstagram\.com\/accounts\/login\b/i,
  /\btiktok\.com\/login\b/i,
  /\bfacebook\.com\/login(\.php)?\b/i,
  /\b(m|mbasic|touch)\.facebook\.com\b/i,
];

function importsOf(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)) names.push(match[1]!);
  return names;
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

describe("no device, emulator, private-API or managed-account posting", () => {
  it("finds no device, emulator, Appium, ADB, private-API or consumer-login automation code in src/ or scripts/", async () => {
    const hits: string[] = [];
    for (const full of [...(await files(path.join(ROOT, "src"))), ...(await files(path.join(ROOT, "scripts")))]) {
      const rel = path.relative(ROOT, full);
      if (rel === SELF) continue;
      const text = await readFile(full, "utf8");
      for (const pattern of FORBIDDEN_CODE) if (pattern.test(text)) hits.push(`${rel}: ${pattern}`);
      for (const specifier of importsOf(text)) {
        if (FORBIDDEN_PACKAGES.includes(packageName(specifier))) hits.push(`${rel}: imports ${specifier}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("e2e specs drive only this app: no platform logins, private APIs or device tooling", async () => {
    const hits: string[] = [];
    for (const full of await files(path.join(ROOT, "e2e"))) {
      const text = await readFile(full, "utf8");
      for (const pattern of FORBIDDEN_CODE) if (pattern.test(text)) hits.push(`${path.relative(ROOT, full)}: ${pattern}`);
      for (const specifier of importsOf(text)) {
        const name = packageName(specifier);
        if (FORBIDDEN_PACKAGES.includes(name) && name !== "@playwright/test") hits.push(`${path.relative(ROOT, full)}: imports ${specifier}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("ships no device, automation or private-API package; the only browser tool is @playwright/test, as a dev dependency for e2e", async () => {
    const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const runtime = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies });
    expect(runtime.filter((name) => FORBIDDEN_PACKAGES.includes(name))).toEqual([]);
    const dev = Object.keys(pkg.devDependencies ?? {});
    expect(dev.filter((name) => FORBIDDEN_PACKAGES.includes(name) && name !== "@playwright/test")).toEqual([]);
  });

  it("the scan is not vacuous: each signature catches a sample", () => {
    const samples = [
      "adb shell input tap 10 10",
      "uiautomator2",
      "XCUITest",
      "http://127.0.0.1:4723/wd/hub",
      "emulator-5554",
      "bluestacks",
      "https://i.instagram.com/api/v1/media/configure/",
      "https://www.instagram.com/api/v1/web/accounts/login/ajax/",
      "ig_sig_key",
      "https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/",
      "api2.musical.ly",
      "X-Gorgon",
      "com.zhiliaoapp.musically",
      "com.ss.android.ugc.trill",
      "com.instagram.android",
      "com.facebook.katana",
      "https://www.instagram.com/accounts/login/",
      "https://www.tiktok.com/login",
      "https://www.facebook.com/login.php",
      "https://m.facebook.com/",
    ];
    for (const pattern of FORBIDDEN_CODE) expect(samples.some((sample) => pattern.test(sample)), String(pattern)).toBe(true);
    expect(importsOf(`import { remote } from "webdriverio"; const a = require("appium-adb");`).map(packageName)).toEqual(["webdriverio", "appium-adb"]);
    // Official endpoints the live publishers use must stay allowed.
    for (const ok of ["https://open.tiktokapis.com/v2/" + "video/list/", "https://graph.instagram.com/v24.0/me", "https://graph.facebook.com/v24.0/me"]) {
      expect(FORBIDDEN_CODE.some((pattern) => pattern.test(ok)), ok).toBe(false);
    }
  });
});

describe("only TikTok, Instagram and Facebook are reachable by publishing", () => {
  it("narrows every other platform the schema knows about, and has publishers for exactly the three", async () => {
    expect([...PLATFORMS].sort()).toEqual(["facebook", "instagram", "tiktok"]);
    expect(Object.keys(PLATFORM_MODES).sort()).toEqual(["facebook", "instagram", "tiktok"]);
    const others = socialPlatform.enumValues.filter((value) => !(PLATFORMS as string[]).includes(value));
    expect(others.length).toBeGreaterThan(0);
    for (const value of [...others, "x", "snapchat", "threads", ""]) {
      expect(isPlatform(value)).toBe(false);
      expect(() => asPlatform(value)).toThrow(/not supported/);
    }
    const live = (await readdir(path.join(ROOT, "src", "lib", "publish", "live"))).sort();
    expect(live).toEqual(["facebook.ts", "http.ts", "instagram.ts", "tiktok.ts"]);
  });

  it("a connection on any other platform cannot be targeted, and an attempt on one fails closed with nothing sent", async () => {
    const { workspace, user } = await signupAccount({
      email: `platforms-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      password: "correct-horse-battery",
      workspaceName: "Platforms Co",
    });
    const db = await getDb();
    const [youtube] = await db
      .insert(publishingConnections)
      .values({ workspaceId: workspace.id, platform: "youtube", externalAccountId: "yt-1", accessTokenCiphertext: sealToken("t"), mode: "mock" })
      .returning();
    await expect(validateTargets(workspace.id, [{ accountId: youtube!.id, mode: "reel" }])).rejects.toThrow(/connected account/);

    const [video] = await db
      .insert(videos)
      .values({
        workspaceId: workspace.id,
        title: "Platform check",
        status: "approved",
        aiGenerated: true,
        approval: { privacy: "public", musicConsent: true, scheduleConsent: true, approvedBy: user.id },
      })
      .returning();
    const [attempt] = await db
      .insert(publishAttempts)
      .values({ workspaceId: workspace.id, videoId: video!.id, connectionId: youtube!.id, platform: "youtube", mode: "reel" })
      .returning();
    const result = await runPublishJob(attempt!.id);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/not supported/);
    const events = await db.select().from(publishEvents).where(eq(publishEvents.jobId, attempt!.id));
    expect(events.map((event) => event.status)).toEqual(["processing", "failed"]);
  });
});
