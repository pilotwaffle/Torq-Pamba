import { describe, expect, it } from "vitest";
import { buildHooks, cleanTopic, normalizePhrase, toTitleCase, ugcScenes } from "@/lib/agent/copy";

describe("normalizePhrase", () => {
  it("strips leading for-phrases, trailing punctuation, and fixes casing", () => {
    expect(normalizePhrase("Made for busy commuters and remote workers.")).toBe(
      "Busy commuters and remote workers",
    );
    expect(normalizePhrase("Built for founders")).toBe("Founders");
    expect(normalizePhrase("For Cold brew coffee")).toBe("Cold brew coffee");
    expect(normalizePhrase("for  for Cold brew coffee.")).toBe("Cold brew coffee");
    expect(normalizePhrase("calm half-smile..")).toBe("Calm half-smile");
    expect(normalizePhrase("  friendly  ")).toBe("Friendly");
    expect(normalizePhrase("Oat-milk cold brew")).toBe("Oat-milk cold brew");
    expect(normalizePhrase("BUSY COMMUTERS")).toBe("Busy commuters");
  });
});

describe("cleanTopic", () => {
  it("takes the about-clause and drops our", () => {
    expect(cleanTopic("Make a 30s video about our new oat-milk cold brew for busy commuters")).toBe(
      "New oat-milk cold brew for busy commuters",
    );
    expect(cleanTopic("our oat-milk cold brew for busy commuters")).toBe("Oat-milk cold brew for busy commuters");
    expect(cleanTopic("create 2 15s videos about the launch")).toBe("Launch");
  });
});

describe("toTitleCase", () => {
  it("title-cases hyphenated words and keeps small words small", () => {
    expect(toTitleCase("new oat-milk cold brew for busy commuters")).toBe(
      "New Oat-Milk Cold Brew for Busy Commuters",
    );
  });
});

describe("ugc copy", () => {
  it("keeps hooks punchy, distinct, and within 60 characters", () => {
    const hooks = buildHooks({
      product: "Oat-milk cold brew",
      audience: "Busy commuters and remote workers",
      company: "Northwind Cold Brew",
    });
    expect(hooks).toHaveLength(3);
    expect(new Set(hooks).size).toBe(3);
    for (const hook of hooks) {
      expect(hook.length).toBeGreaterThan(0);
      expect(hook.length).toBeLessThanOrEqual(60);
    }
    expect(hooks.join(" ")).not.toMatch(/made for made for/i);

    const long = buildHooks({
      product: "A very long product name that should not blow the hook",
      audience: "people who commute, work late, and still want something simple",
      company: "A Company With An Extremely Long Workspace Name",
    });
    for (const hook of long) expect(hook.length).toBeLessThanOrEqual(60);
  });

  it("writes a hook, a demo, and a call to action without pasting the prompt", () => {
    const scenes = ugcScenes({
      avatarName: "Ava",
      product: "Oat-milk cold brew",
      company: "Northwind Cold Brew",
    });
    expect(scenes.visuals[0]).toMatch(/Ava/);
    expect(scenes.visuals[0]).toMatch(/camera/);
    expect(scenes.lines[0]).toMatch(/oat-milk cold brew/i);
    expect(scenes.lines[1].toLowerCase()).toMatch(/use|demo|watch/);
    expect(scenes.lines[2].toLowerCase()).toMatch(/try/);
    const blob = [...scenes.visuals, ...scenes.lines].join(" ");
    expect(blob).not.toMatch(/Make a 30s|half-smile\.\.|for Cold brew coffee|Made for Made/i);
  });
});
