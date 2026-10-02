import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { creditCharges, creditLedger, plans, videos, workspaces } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import { MODELS, type ModelConfig } from "@/lib/models";
import { resetMockRefusals } from "@/lib/providers/mock";
import { generateVideo } from "@/lib/router";
import { getCreditSummary } from "./account";
import { captureCredits, holdCredits, releaseCredits, reserveCredits } from "./charges";
import { appendEntry, ensureSignupGrant, getCreditBalance, InsufficientCreditsError, postEntry } from "./ledger";
import { SIMULATED_STARTER_CREDITS, simulatedBillingAllowed } from "./mode";
import { findTopUpPack, PLANS, toPlanId, TOP_UP_PACKS } from "./plans";
import {
  creditsForScenes,
  creditsPerUnit,
  formatCredits,
  lineCredits,
  quoteClipCredits,
  unitCostUsd,
  USD_PER_CREDIT,
} from "./pricing";

const password = "correct-horse-battery";

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

async function freshWorkspace(label: string) {
  const { workspace } = await signupAccount({ email: email(label), password, workspaceName: `${label} Co` });
  return workspace;
}

/** Moves a workspace's balance to an exact amount with one adjustment. */
async function setBalance(workspaceId: string, credits: number) {
  const current = await getCreditBalance(workspaceId);
  if (current !== credits) {
    await postEntry({ workspaceId, kind: "adjustment", delta: credits - current, description: "test balance" });
  }
}

async function ledgerOf(workspaceId: string) {
  const db = await getDb();
  return db.select().from(creditLedger).where(eq(creditLedger.workspaceId, workspaceId));
}

async function cachedBalance(workspaceId: string) {
  const db = await getDb();
  const [row] = await db.select({ balance: workspaces.creditBalance }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return row?.balance ?? 0;
}

/** The cached balance equals the ledger sum, each row's balance_after is the running total, and none is negative. */
async function expectLedgerConsistent(workspaceId: string) {
  const entries = await ledgerOf(workspaceId);
  expect(entries.reduce((sum, entry) => sum + entry.delta, 0)).toBe(await cachedBalance(workspaceId));
  const ordered = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let running = 0;
  for (const entry of ordered) {
    running += entry.delta;
    expect(entry.balanceAfter).toBe(running);
    expect(entry.balanceAfter).toBeGreaterThanOrEqual(0);
  }
}

function scenes(prompt: string) {
  return [0, 1, 2].map((index) => ({ visual: `${prompt} scene ${index}`, line: `Line ${index}`, durationS: 10 }));
}

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  resetMockRefusals();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("credit pricing", () => {
  it("quotes a 30s clip per tier from catalog list prices", () => {
    expect(quoteClipCredits({ tier: "standard", durationS: 30 })).toEqual({
      script: 12,
      frames: 31,
      video: 457,
      voice: 0,
      total: 500,
    });
    expect(quoteClipCredits({ tier: "budget", durationS: 30 }).total).toBe(239);
    expect(quoteClipCredits({ tier: "premium", durationS: 30 }).total).toBe(1885);
    expect(quoteClipCredits({ tier: "premium", durationS: 60 }).total).toBe(3685);
  });

  it("prices avatar engines with their own frames and voice", () => {
    expect(quoteClipCredits({ tier: "budget", durationS: 30, avatarEngine: "kling-avatar" })).toEqual({
      script: 5,
      frames: 3,
      video: 252,
      voice: 4,
      total: 264,
    });
  });

  it("never sells a model below its list price", () => {
    for (const model of MODELS) {
      expect(creditsPerUnit(model) * USD_PER_CREDIT, model.id).toBeGreaterThanOrEqual(unitCostUsd(model));
    }
  });

  it("uses a catalog entry's credits when set, and list cost plus markup otherwise", () => {
    const base: ModelConfig = {
      kind: "video",
      id: "unpriced",
      vendor: "test",
      label: "Unpriced",
      tier: "standard",
      usdPerSecond: 0.08,
      maxDurationS: 30,
      source: "test fixture",
    };
    expect(creditsPerUnit(base)).toBeCloseTo(12, 9);
    expect(lineCredits(base, 30)).toBe(360);
    expect(lineCredits({ ...base, credits: 20 }, 30)).toBe(600);
    expect(lineCredits(base, 0)).toBe(0);
  });

  it("charges the models that actually ran, never more than the quote", () => {
    const quote = quoteClipCredits({ tier: "standard", durationS: 30 }).total;
    expect(creditsForScenes("standard", scenes("x").map(() => ({ durationS: 10, model: "omni-flash" })))).toBe(quote);
    const mixed = [
      { durationS: 10, model: "veo-3.1-lite" },
      { durationS: 10, model: "omni-flash" },
      { durationS: 10, model: "omni-flash" },
    ];
    expect(creditsForScenes("standard", mixed)).toBe(12 + 31 + 75 + 305);
    expect(creditsForScenes("standard", mixed)).toBeLessThan(quote);
  });

  it("formats credits", () => {
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(10_000)).toBe("10,000 credits");
  });
});

describe("plans", () => {
  it("mirror the seeded plans table", async () => {
    const db = await getDb();
    const rows = await db.select().from(plans);
    const seeded = rows
      .map((row) => ({ id: row.id, name: row.name, monthlyPriceCents: row.monthlyPriceCents, monthlyCredits: row.monthlyCredits }))
      .sort((a, b) => a.monthlyPriceCents - b.monthlyPriceCents);
    expect(PLANS.map(({ id, name, monthlyPriceCents, monthlyCredits }) => ({ id, name, monthlyPriceCents, monthlyCredits }))).toEqual(
      seeded,
    );
    expect(seeded.find((row) => row.id === "hobby")).toMatchObject({ monthlyPriceCents: 1600, monthlyCredits: 1600 });
    expect(seeded.find((row) => row.id === "pro")).toMatchObject({ monthlyPriceCents: 10000, monthlyCredits: 10000 });
  });

  it("maps legacy plan names and finds packs", () => {
    expect(toPlanId("creator")).toBe("hobby");
    expect(toPlanId("studio")).toBe("pro");
    expect(toPlanId("enterprise")).toBeNull();
    expect(findTopUpPack("credits-2000")).toEqual({ id: "credits-2000", credits: 2000, amountCents: 2000 });
    expect(findTopUpPack("free-money")).toBeNull();
    for (const pack of TOP_UP_PACKS) expect(pack.amountCents).toBe(Math.round(pack.credits * USD_PER_CREDIT * 100));
  });
});

describe("ledger", () => {
  it("grants simulated starter credits once, even when asked concurrently", async () => {
    const workspace = await freshWorkspace("starter");
    await Promise.all(Array.from({ length: 6 }, () => ensureSignupGrant(workspace.id)));
    expect(await getCreditBalance(workspace.id)).toBe(SIMULATED_STARTER_CREDITS);
    expect((await ledgerOf(workspace.id)).filter((entry) => entry.kind === "signup_grant")).toHaveLength(1);
    await expectLedgerConsistent(workspace.id);
  });

  it("grants only the plan's signup credits (0 for Free) when Stripe is configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_placeholder");
    expect(simulatedBillingAllowed()).toBe(false);
    const workspace = await freshWorkspace("real-billing");
    expect(await getCreditBalance(workspace.id)).toBe(0);
    expect(await ledgerOf(workspace.id)).toHaveLength(0);
  });

  it("never simulates billing in a production build with live providers", () => {
    expect(simulatedBillingAllowed({ NODE_ENV: "production", PROVIDER_MODE: "live" })).toBe(false);
    expect(simulatedBillingAllowed({ NODE_ENV: "production", PROVIDER_MODE: "mock" })).toBe(true);
    expect(simulatedBillingAllowed({ NODE_ENV: "development", PROVIDER_MODE: "live" })).toBe(true);
    expect(simulatedBillingAllowed({ NODE_ENV: "development", STRIPE_SECRET_KEY: "sk_test_x" })).toBe(false);
  });

  it("applies an idempotency key once and refuses debits below zero", async () => {
    const workspace = await freshWorkspace("idem");
    await setBalance(workspace.id, 100);
    const key = `test:${workspace.id}`;
    const entry = { workspaceId: workspace.id, kind: "adjustment" as const, delta: 50, description: "a", idempotencyKey: key };
    const results = await Promise.all([postEntry(entry), postEntry(entry), postEntry(entry)]);
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(await cachedBalance(workspace.id)).toBe(150);
    await expect(
      postEntry({ workspaceId: workspace.id, kind: "adjustment", delta: -151, description: "too much" }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    const db = await getDb();
    await expect(
      db.transaction((tx) => appendEntry(tx, { workspaceId: workspace.id, kind: "adjustment", delta: 0, description: "zero" })),
    ).rejects.toThrow(/non-zero/);
    expect(await cachedBalance(workspace.id)).toBe(150);
    await expectLedgerConsistent(workspace.id);
  });
});

describe("charges", () => {
  it("lets concurrent reservations spend each credit only once", async () => {
    const workspace = await freshWorkspace("race");
    await setBalance(workspace.id, 5_000);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 1_000, description: `race ${index}` }),
      ),
    );
    const refused = results.filter((result) => result.status === "rejected");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(refused).toHaveLength(7);
    for (const result of refused) expect(result.reason).toBeInstanceOf(InsufficientCreditsError);
    expect(await cachedBalance(workspace.id)).toBe(0);
    const db = await getDb();
    expect(await db.select().from(creditCharges).where(eq(creditCharges.workspaceId, workspace.id))).toHaveLength(5);
    await expectLedgerConsistent(workspace.id);
  });

  it("keeps the balance consistent when captures, releases and grants interleave", async () => {
    const workspace = await freshWorkspace("interleave");
    await setBalance(workspace.id, 3_000);
    const reserved = await Promise.all(
      [500, 700, 900].map((credits, index) =>
        reserveCredits({ workspaceId: workspace.id, kind: "clip", credits, description: `job ${index}` }),
      ),
    );
    await Promise.all([
      captureCredits(reserved[0]!.chargeId, { credits: 400 }),
      releaseCredits(reserved[1]!.chargeId),
      captureCredits(reserved[2]!.chargeId, { credits: 5_000 }),
      postEntry({ workspaceId: workspace.id, kind: "top_up", delta: 250, description: "grant" }),
      releaseCredits(reserved[1]!.chargeId),
      captureCredits(reserved[1]!.chargeId, { credits: 700 }),
    ]);
    // Job 1 is either released (refund) or captured, never both.
    const db = await getDb();
    const [second] = await db.select().from(creditCharges).where(eq(creditCharges.id, reserved[1]!.chargeId));
    const secondCost = second?.status === "captured" ? 700 : 0;
    expect(await cachedBalance(workspace.id)).toBe(3_000 - 400 - secondCost - 900 + 250);
    await expectLedgerConsistent(workspace.id);
  });

  it("captures at most the reservation, refunds the rest, and settles once", async () => {
    const workspace = await freshWorkspace("capture");
    await setBalance(workspace.id, 1_000);
    const { chargeId } = await reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 500, description: "clip" });
    expect(await cachedBalance(workspace.id)).toBe(500);
    expect(await captureCredits(chargeId, { credits: 300 })).toEqual({ captured: 300, refunded: 200 });
    expect(await captureCredits(chargeId, { credits: 300 })).toEqual({ captured: 300, refunded: 0 });
    expect(await releaseCredits(chargeId)).toEqual({ refunded: 0 });
    expect(await cachedBalance(workspace.id)).toBe(700);
    const db = await getDb();
    const [charge] = await db.select().from(creditCharges).where(eq(creditCharges.id, chargeId));
    expect(charge).toMatchObject({ status: "captured", credits: 300 });
    await expectLedgerConsistent(workspace.id);
  });

  it("refunds a failed job in full and cannot be captured afterwards", async () => {
    const workspace = await freshWorkspace("release");
    await setBalance(workspace.id, 600);
    const { chargeId } = await reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 500, description: "clip" });
    expect(await releaseCredits(chargeId)).toEqual({ refunded: 500 });
    expect(await captureCredits(chargeId, { credits: 500 })).toEqual({ captured: 0, refunded: 0 });
    expect(await cachedBalance(workspace.id)).toBe(600);
    await expectLedgerConsistent(workspace.id);
  });

  it("reports a short balance as a result with an upgrade or top-up prompt", async () => {
    const workspace = await freshWorkspace("short");
    await setBalance(workspace.id, 100);
    const held = await holdCredits({ workspaceId: workspace.id, kind: "clip", credits: 500, description: "clip" });
    expect(held).toMatchObject({ ok: false, required: 500, balance: 100 });
    if (!held.ok) expect(held.error).toMatch(/500 credits.*100 credits.*Top up credits or upgrade your plan/);
  });
});

describe("generateVideo with credits", () => {
  const input = (workspaceId: string, prompt: string) => ({
    workspaceId,
    tier: "standard" as const,
    title: prompt,
    prompt,
    hook: "Hook",
    voiceLines: ["a", "b", "c"],
    scenes: scenes(prompt),
  });

  it("charges the quote on success and records it on the video", async () => {
    const workspace = await freshWorkspace("gen-ok");
    const before = await getCreditBalance(workspace.id);
    const result = await generateVideo(input(workspace.id, "oat milk"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await getCreditBalance(workspace.id)).toBe(before - 500);
    const db = await getDb();
    const [video] = await db.select().from(videos).where(eq(videos.id, result.videoId));
    expect(video?.creditsCharged).toBe(500);
    const [charge] = await db.select().from(creditCharges).where(eq(creditCharges.videoId, result.videoId));
    expect(charge).toMatchObject({ status: "captured", credits: 500, kind: "clip", model: "omni-flash" });
    await expectLedgerConsistent(workspace.id);
  });

  it("charges less when a cheaper fallback model finishes a scene", async () => {
    const workspace = await freshWorkspace("gen-fallback");
    const before = await getCreditBalance(workspace.id);
    const result = await generateVideo(input(workspace.id, "launch [refuse]"));
    expect(result.ok).toBe(true);
    const spent = before - (await getCreditBalance(workspace.id));
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThan(500);
    await expectLedgerConsistent(workspace.id);
  });

  it("refunds everything when every model fails", async () => {
    const workspace = await freshWorkspace("gen-fail");
    const before = await getCreditBalance(workspace.id);
    const result = await generateVideo(input(workspace.id, "launch [refuse-all]"));
    expect(result.ok).toBe(false);
    expect(await getCreditBalance(workspace.id)).toBe(before);
    const db = await getDb();
    const charges = await db.select().from(creditCharges).where(eq(creditCharges.workspaceId, workspace.id));
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ status: "released" });
    expect(charges[0]?.videoId).toBeTruthy();
    const [video] = await db.select().from(videos).where(eq(videos.workspaceId, workspace.id));
    expect(video?.creditsCharged).toBe(0);
    await expectLedgerConsistent(workspace.id);
  });

  it("blocks generation without enough credits and writes nothing", async () => {
    const workspace = await freshWorkspace("gen-broke");
    await setBalance(workspace.id, 100);
    const result = await generateVideo(input(workspace.id, "oat milk"));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/500 credits.*100 credits.*Billing page/) });
    const db = await getDb();
    expect(await db.select().from(videos).where(eq(videos.workspaceId, workspace.id))).toHaveLength(0);
    expect(await db.select().from(creditCharges).where(eq(creditCharges.workspaceId, workspace.id))).toHaveLength(0);
    expect(await getCreditBalance(workspace.id)).toBe(100);
  });

  it("does not let parallel generations overspend the balance", async () => {
    const workspace = await freshWorkspace("gen-race");
    await setBalance(workspace.id, 1_200);
    const results = await Promise.all(
      [0, 1, 2, 3].map((index) => generateVideo(input(workspace.id, `parallel ${index}`))),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(await getCreditBalance(workspace.id)).toBe(200);
    await expectLedgerConsistent(workspace.id);
  });
});

describe("credit summary", () => {
  it("lists the balance, plan and newest ledger entries first", async () => {
    const workspace = await freshWorkspace("summary");
    await getCreditBalance(workspace.id);
    await postEntry({ workspaceId: workspace.id, kind: "top_up", delta: 500, description: "Top-up" });
    const summary = await getCreditSummary(workspace.id);
    expect(summary.balance).toBe(SIMULATED_STARTER_CREDITS + 500);
    expect(summary.plan.id).toBe("free");
    expect(summary.plans.map((plan) => plan.id)).toEqual(["free", "hobby", "pro"]);
    expect(summary.ledger.map((entry) => entry.description)).toEqual(["Top-up", "Starter credits (simulated billing)"]);
  });
});
