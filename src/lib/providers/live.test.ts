import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNanoBananaRequest, liveNanoBanana, nanoBananaInlineImage } from "./google";
import { pollTimeoutMs, pollUntil } from "./live";
import { ProviderUnavailableError } from "./types";

// Clip submit/poll per vendor is covered by adapters.test.ts and the job runner tests (wave 1).
// This file keeps the generic poller the publishers use, and the Nano Banana image adapter.

type Route = (url: string, init?: RequestInit) => Response | undefined;
const calls: { url: string; init?: RequestInit }[] = [];
const saved: Record<string, string | undefined> = {};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(routes: Route[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, init });
      for (const route of routes) {
        const response = route(url, init);
        if (response) return response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

beforeEach(() => {
  calls.length = 0;
  saved.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-gemini";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("pollUntil", () => {
  it("backs off between polls and returns the first non-null result", async () => {
    const sleeps: number[] = [];
    let polls = 0;
    const result = await pollUntil(
      "test",
      async () => (++polls >= 4 ? "done-url" : null),
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(result).toBe("done-url");
    expect(sleeps).toEqual([5000, 7500, 11250]);
  });

  it("gives up with ProviderUnavailableError once the time budget is spent", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const run = pollUntil("slow", async () => null, {
      timeoutMs: 120_000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    await expect(run).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(run).rejects.toThrow(/timed out/);
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(120_000);
    expect(Math.max(...sleeps)).toBe(20_000);
  });

  it("defaults to a 10 minute budget, overridable by PROVIDER_POLL_TIMEOUT_MS", () => {
    const previous = process.env.PROVIDER_POLL_TIMEOUT_MS;
    try {
      delete process.env.PROVIDER_POLL_TIMEOUT_MS;
      expect(pollTimeoutMs()).toBe(600_000);
      process.env.PROVIDER_POLL_TIMEOUT_MS = "90000";
      expect(pollTimeoutMs()).toBe(90_000);
    } finally {
      if (previous === undefined) delete process.env.PROVIDER_POLL_TIMEOUT_MS;
      else process.env.PROVIDER_POLL_TIMEOUT_MS = previous;
    }
  });
});

describe("Nano Banana", () => {
  it("builds a 9:16 image request, decodes inline data, and returns it as a data URL", async () => {
    expect(buildNanoBananaRequest("a can").generationConfig).toEqual({
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "9:16" },
    });
    expect(nanoBananaInlineImage({ candidates: [{ content: { parts: [{}] } }] })).toBeNull();
    const png = Buffer.from([137, 80, 78, 71]).toString("base64");
    stubFetch([
      (url) =>
        url.includes(":generateContent")
          ? json({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: png } }] } }] })
          : undefined,
    ]);
    const result = await liveNanoBanana("nano-banana-2", "a can of cold brew");
    expect(result.costUsd).toBe(0.067);
    expect(result.url).toBe(`data:image/png;base64,${png}`);
    expect(calls[0]?.url).toContain("gemini-3.1-flash-image-preview:generateContent");
  });
});
