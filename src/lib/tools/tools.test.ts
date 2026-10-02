import { describe, expect, it } from "vitest";
import { validateServiceRequest } from "@/lib/service";
import { captionStats, srtTimestamp, timeCues, toSrt, wrapLines } from "./captions";
import { deslop } from "./deslop";
import { combinedSafeZone, isVertical, overlapIssues, safeZone } from "./safezone";

describe("safe-zone previewer", () => {
  it("computes each platform's safe rectangle on a 1080x1920 frame", () => {
    expect(safeZone("tiktok", 1080, 1920)).toEqual({ x: 54, y: 154, w: 886, h: 1382 });
    expect(safeZone("instagram", 1080, 1920)).toEqual({ x: 54, y: 230, w: 896, h: 1306 });
    expect(isVertical(1080, 1920)).toBe(true);
    expect(isVertical(1920, 1080)).toBe(false);
  });

  it("intersects platforms and names the UI that would cover a text box", () => {
    const zone = combinedSafeZone(["tiktok", "instagram", "facebook"], 1080, 1920);
    expect(zone).toEqual({ x: 54, y: 230, w: 886, h: 1267 });
    expect(overlapIssues({ ...zone }, { width: 1080, height: 1920 }, ["tiktok", "instagram", "facebook"])).toEqual([]);
    const low = overlapIssues({ x: 54, y: 1700, w: 1000, h: 100 }, { width: 1080, height: 1920 }, ["tiktok"]);
    expect(low).toEqual(["TikTok: caption and music bar cover the bottom of this text", "TikTok: action buttons cover the right side of this text"]);
    expect(overlapIssues({ x: 54, y: 180, w: 800, h: 100 }, { width: 1080, height: 1920 }, ["instagram"])).toEqual([
      "Instagram Reels: top bar covers the top of this text",
    ]);
    expect(combinedSafeZone([], 1080, 1920)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });
});

describe("caption toolkit", () => {
  it("wraps words into lines without splitting words", () => {
    expect(wrapLines("Grab one on the way to work and skip the line entirely", 20)).toEqual(["Grab one on the way", "to work and skip the", "line entirely"]);
    expect(wrapLines("supercalifragilisticexpialidocious yes", 10)).toEqual(["supercalifragilisticexpialidocious", "yes"]);
    expect(wrapLines("   ")).toEqual([]);
  });

  it("times cues by speaking rate, two lines at most, at least 0.8 s each", () => {
    const cues = timeCues("Hi. Grab one on the way to work and skip the line entirely today.", { wordsPerSecond: 2, maxChars: 20 });
    expect(cues).toEqual([
      { text: "Hi.", startS: 0, endS: 0.8 },
      { text: "Grab one on the way\nto work and skip the", startS: 0.8, endS: 5.8 },
      { text: "line entirely today.", startS: 5.8, endS: 7.3 },
    ]);
  });

  it("writes valid SRT and checks post captions against limits", () => {
    expect(srtTimestamp(3725.5)).toBe("01:02:05,500");
    expect(toSrt([{ text: "Hi", startS: 0, endS: 1.25 }])).toBe("1\n00:00:00,000 --> 00:00:01,250\nHi\n");
    const stats = captionStats("Cold brew #coffee #oat #morning @northwind");
    expect(stats).toMatchObject({ hashtags: 3, mentions: 1, warnings: [] });
    const many = captionStats(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "));
    expect(many.warnings).toEqual([
      "Instagram allows 30 hashtags; this has 31.",
      "More than 5 hashtags rarely helps reach; 3-5 specific ones work better.",
    ]);
    expect(captionStats("x".repeat(2201)).warnings[0]).toBe("Instagram allows 2200 characters; this is 2201.");
  });
});

describe("de-slop rewriter", () => {
  it("removes stock openers and swaps stock verbs, keeping case", () => {
    const { text, changes } = deslop("In today's fast-paced world, we delve into coffee. Moreover, it's a game-changer!!");
    expect(text).toBe("We dig into coffee. Also, it's a big deal!");
    expect(changes.map((c) => c.reason)).toEqual(["Throat-clearing opener", "Essay connector", "Stock AI verb", "Hype cliché", "Stacked exclamation marks"]);
  });

  it("rewrites the not-just formula and keeps verb tense", () => {
    expect(deslop("It's not just coffee, it's a ritual.").text).toBe("It's a ritual.");
    expect(deslop("We leveraged AI and are leveraging it. It revolutionized mornings.").text).toBe("We used AI and are using it. It changed mornings.");
    expect(deslop("Navigating the complexities of mornings.").text).toBe("Dealing with mornings.");
  });

  it("replaces heavy em-dash use and leaves clean text alone", () => {
    expect(deslop("Fast — cold — smooth — done.").text).toBe("Fast, cold, smooth, done.");
    expect(deslop("One dash — fine.").text).toBe("One dash — fine.");
    expect(deslop("Grab one on the way.")).toEqual({ text: "Grab one on the way.", changes: [] });
  });
});

describe("done-with-you requests", () => {
  it("validates the lead form", () => {
    const ok = { name: "Ada", email: "ada@northwind.example", company: "Northwind", monthlyVideos: 20, message: "Cold brew" };
    expect(validateServiceRequest(ok)).toEqual([]);
    expect(validateServiceRequest({ ...ok, name: "", email: "nope", monthlyVideos: 0, message: "x".repeat(2001) })).toEqual([
      "Enter your name",
      "Enter a valid email",
      "Videos per month must be 1 to 1000",
      "Message must be 2000 characters or fewer",
    ]);
  });
});
