import { describe, expect, it } from "vitest";
import { withProvenHook } from "@/lib/agent/plan";
import { briefToCsv, briefToMarkdown, buildCreatorBriefBody, csvCell, CSV_COLUMNS, validateBriefInput, type CreatorBriefInput } from "./creators";
import { pickWinner, type VariantStats } from "./experiments";
import { codeHint, validateSparkCode } from "./handoff";
import { captionsWithHook, generateHookVariants, HOOK_MAX_CHARS, hookPolicyIssues } from "./hooks";
import { validateTile } from "./knowledge";

const input = { product: "Oat-milk cold brew", audience: "Night-shift nurses", company: "Northwind" };

function stat(label: string, views: number, rate: number, measured = true): VariantStats {
  return { variantId: `v-${label}`, label, hook: `Hook ${label}`, pattern: "pov", videoId: `vid-${label}`, jobStatus: "published", views, engagementRate: rate, measured };
}

const form: CreatorBriefInput = {
  title: "Fall cold brew UGC",
  budgetUsd: 600,
  videoCount: 4,
  lengthS: 30,
  platforms: ["tiktok", "instagram"],
  usageRightsDays: 90,
  allowSparkAds: true,
  allowPartnershipAds: false,
  dueDate: "2026-10-20",
  marketplaces: ["tiktok_one", "billo"],
};

describe("hook variants", () => {
  it("keeps the original as control A and adds distinct, policy-clean variants of at most 60 characters", () => {
    const variants = generateHookVariants({ ...input, baseHook: "Stop scrolling — Oat-milk cold brew.", count: 4 });
    expect(variants.map((v) => v.label)).toEqual(["A", "B", "C", "D"]);
    expect(variants[0]).toMatchObject({ pattern: "control", hook: "Stop scrolling — Oat-milk cold brew." });
    expect(new Set(variants.map((v) => v.hook.toLowerCase())).size).toBe(4);
    for (const variant of variants) {
      expect(variant.hook.length).toBeLessThanOrEqual(HOOK_MAX_CHARS);
      expect(hookPolicyIssues(variant.hook)).toEqual([]);
    }
  });

  it("tries proven patterns from Knowledge first and ignores unknown ones", () => {
    const variants = generateHookVariants({ ...input, baseHook: "Watch this.", count: 3, preferPatterns: ["nonsense", "before_after", "proof"] });
    expect(variants.slice(1).map((v) => v.pattern)).toEqual(["before_after", "proof"]);
    expect(variants[1]?.hook).toBe("My day before Oat-milk cold brew vs after.");
  });

  it("clamps the variant count to 2-5", () => {
    expect(generateHookVariants({ ...input, baseHook: "x", count: 1 })).toHaveLength(2);
    expect(generateHookVariants({ ...input, baseHook: "x", count: 50 })).toHaveLength(5);
  });

  it("flags hooks that make claims platforms reject, are empty, or run long", () => {
    expect(hookPolicyIssues("Guaranteed results in 3 days")).toEqual(['Hook makes a claim platforms reject ("guarantee")']);
    expect(hookPolicyIssues("This miracle drink cures everything")).toHaveLength(2);
    expect(hookPolicyIssues("  ")).toContain("Hook is empty");
    expect(hookPolicyIssues("x".repeat(61))).toContain("Hook is longer than 60 characters");
    expect(hookPolicyIssues("POV: you finally found cold brew.")).toEqual([]);
  });

  it("puts the hook on screen for the first two seconds ahead of the spoken captions", () => {
    const captions = [{ text: "Grab one", startS: 0, endS: 5 }, { text: "Done", startS: 5, endS: 10 }];
    expect(captionsWithHook(captions, "POV: cold brew")).toEqual([{ text: "POV: cold brew", startS: 0, endS: 2 }, ...captions]);
    expect(captionsWithHook([{ text: "Short", startS: 0, endS: 1.2 }], "H")[0]).toEqual({ text: "H", startS: 0, endS: 1.2 });
  });
});

describe("winner selection", () => {
  it("waits until every variant has metrics", () => {
    const decision = pickWinner([stat("A", 900, 5), stat("B", 0, 0, false)], { metric: "views", minViews: 300 });
    expect(decision).toEqual({ kind: "insufficient", reason: "Not enough data yet: variant B has no metrics. Refresh metrics after it posts." });
  });

  it("waits until every variant reaches the minimum views", () => {
    const decision = pickWinner([stat("A", 900, 5), stat("B", 120, 9)], { metric: "views", minViews: 300 });
    expect(decision.kind).toBe("insufficient");
    if (decision.kind === "insufficient") expect(decision.reason).toMatch(/variant B has 120 views \(needs 300\)/);
  });

  it("picks the most-viewed variant and reports its lift over the runner-up", () => {
    const decision = pickWinner([stat("A", 1000, 6), stat("B", 1500, 4), stat("C", 1200, 5)], { metric: "views", minViews: 300 });
    expect(decision.kind).toBe("winner");
    if (decision.kind !== "winner") return;
    expect(decision.winner.label).toBe("B");
    expect(decision.runnerUp?.label).toBe("C");
    expect(decision.liftPct).toBe(25);
    expect(decision.confidence).toBe("clear");
    expect(decision.ranking.map((row) => row.label)).toEqual(["B", "C", "A"]);
  });

  it("ranks by engagement rate when the test measures engagement", () => {
    const decision = pickWinner([stat("A", 1000, 6), stat("B", 1500, 4)], { metric: "engagement", minViews: 300 });
    expect(decision.kind === "winner" && decision.winner.label).toBe("A");
  });

  it("marks a lift under 10% as low confidence and breaks ties by label", () => {
    const close = pickWinner([stat("A", 1000, 5), stat("B", 1050, 5)], { metric: "views", minViews: 300 });
    expect(close.kind === "winner" && [close.winner.label, close.liftPct, close.confidence]).toEqual(["B", 5, "low"]);
    const tie = pickWinner([stat("B", 800, 5), stat("A", 800, 5)], { metric: "views", minViews: 300 });
    expect(tie.kind === "winner" && [tie.winner.label, tie.liftPct]).toEqual(["A", 0]);
    expect(pickWinner([stat("A", 800, 5)], { metric: "views", minViews: 1 }).kind).toBe("insufficient");
  });
});

describe("creator briefs", () => {
  it("validates budget, counts, platforms, marketplaces and dates", () => {
    expect(validateBriefInput(form)).toEqual([]);
    const errors = validateBriefInput({ ...form, title: " ", budgetUsd: 0, videoCount: 0, lengthS: 2, platforms: [], marketplaces: [], dueDate: "10/20" });
    expect(errors).toEqual([
      "Give the brief a title",
      "Budget must be more than $0",
      "Ask for 1 to 50 videos",
      "Video length must be 5 to 180 seconds",
      "Choose at least one platform",
      "Choose where you will post the brief",
      "Due date must be YYYY-MM-DD",
    ]);
  });

  it("builds the brief from the brand, the reference video and proven hooks", () => {
    const body = buildCreatorBriefBody({
      form,
      brand: { companyName: "Northwind", products: ["Oat-milk cold brew"], audience: "Night-shift nurses", whatTheyDo: "Cold brew delivered", tone: "warm" },
      referenceVideo: { title: "Cold brew 30s", hook: "POV: you finally found cold brew.", lines: ["Grab one", "Open, go", "Try it"] },
      provenHooks: ["POV: you finally found cold brew.", "My day before vs after."],
    });
    expect(body.product).toBe("Oat-milk cold brew");
    expect(body.hooks).toEqual(["POV: you finally found cold brew.", "My day before vs after."]);
    expect(body.deliverables).toEqual([
      { platform: "tiktok", format: "Vertical 9:16 TikTok video", count: 2, lengthS: 30 },
      { platform: "instagram", format: "Vertical 9:16 Reel", count: 2, lengthS: 30 },
    ]);
    expect(body.talkingPoints[0]).toBe("Cold brew delivered");
    expect(body.dos).toContain("Match the brand's tone: warm.");
    expect(body.disclosure).toMatch(/Paid partnership/);
  });

  it("renders a Markdown brief with rights, ad permissions and disclosure", () => {
    const body = buildCreatorBriefBody({ form, brand: { products: ["Cold brew"] }, provenHooks: ["POV: cold brew"] });
    const md = briefToMarkdown("Fall cold brew UGC", body);
    expect(md.startsWith("# Fall cold brew UGC\n")).toBe(true);
    expect(md).toContain("**Budget:** $600.00 · **Due:** 2026-10-20");
    expect(md).toContain("**Post on:** TikTok One, Billo");
    expect(md).toContain("- 2 × Vertical 9:16 TikTok video, about 30s");
    expect(md).toContain("- “POV: cold brew”");
    expect(md).toContain("Spark Ads authorization code: required on delivery (TikTok).");
    expect(md).toContain("Partnership ads permission: not needed.");
    expect(md).toContain("## Disclosure");
  });

  it("escapes CSV cells and neutralizes spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(42)).toBe("42");
  });

  it("exports one CSV row per deliverable under a fixed header", () => {
    const body = buildCreatorBriefBody({ form, brand: {}, provenHooks: [] });
    const csv = briefToCsv("Fall, UGC", body);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]?.startsWith('"Fall, UGC",tiktok,Vertical 9:16 TikTok video,2,30,600.00,2026-10-20,90,yes,no,')).toBe(true);
  });
});

describe("hand-off and knowledge validation", () => {
  it("accepts Spark Ads codes as pasted and rejects malformed ones", () => {
    expect(validateSparkCode("  #abcDEF123+/=xyz  ")).toBe("#abcDEF123+/=xyz");
    expect(() => validateSparkCode("")).toThrow(/Paste the authorization code/);
    expect(() => validateSparkCode("abc def ghi")).toThrow(/spaces/);
    expect(() => validateSparkCode("short")).toThrow(/8-256/);
    expect(() => validateSparkCode("<script>alert</script>")).toThrow(/characters/);
    expect(codeHint("#abcDEF123")).toBe("…F123");
  });

  it("validates knowledge tiles", () => {
    expect(validateTile({ kind: "hook_result", title: "POV: cold brew", body: "" })).toEqual([]);
    expect(validateTile({ kind: "format", title: "Split-screen before/after", body: "" })).toEqual([]);
    expect(validateTile({ kind: "spell", title: "", body: "x".repeat(1001) })).toEqual([
      "Choose a tile type",
      "Title is required",
      "Notes must be 1000 characters or fewer",
    ]);
  });

  it("leads chat plans with the best proven hook, keeping three distinct hooks", () => {
    const defaults: [string, string, string] = ["Stop scrolling — brew.", "Made for nurses.", "Northwind: try it today."];
    expect(withProvenHook(defaults, [])).toEqual(defaults);
    expect(withProvenHook(defaults, ["POV: you finally found brew."])).toEqual(["POV: you finally found brew.", "Stop scrolling — brew.", "Made for nurses."]);
    expect(withProvenHook(defaults, ["made for nurses."])).toEqual(["made for nurses.", "Stop scrolling — brew.", "Northwind: try it today."]);
    expect(withProvenHook(defaults, ["x ".repeat(80)])[0]!.length).toBeLessThanOrEqual(60);
  });
});
