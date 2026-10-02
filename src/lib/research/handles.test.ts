import { describe, expect, it } from "vitest";
import { parseAccountInput } from "./handles";
import { ResearchError } from "./types";

describe("parseAccountInput", () => {
  it("reads profile URLs for each platform and sets the platform from the host", () => {
    expect(parseAccountInput("https://www.tiktok.com/@BrewByBea?lang=en")).toEqual({
      platform: "tiktok",
      handle: "brewbybea",
      profileUrl: "https://www.tiktok.com/@brewbybea",
    });
    expect(parseAccountInput("instagram.com/slowpour.studio/")).toMatchObject({ platform: "instagram", handle: "slowpour.studio" });
    expect(parseAccountInput("https://m.youtube.com/@HomeBaristaClub/shorts")).toMatchObject({
      platform: "youtube",
      handle: "homebaristaclub",
      profileUrl: "https://www.youtube.com/@homebaristaclub",
    });
    expect(parseAccountInput("https://www.facebook.com/northwind", "tiktok")).toMatchObject({ platform: "facebook" });
  });

  it("needs a platform for a bare handle and strips the @", () => {
    expect(parseAccountInput("@Oat_And_Ice", "instagram")).toEqual({
      platform: "instagram",
      handle: "oat_and_ice",
      profileUrl: "https://www.instagram.com/oat_and_ice/",
    });
    expect(() => parseAccountInput("oatandice")).toThrow(ResearchError);
  });

  it("rejects post links, other sites, and impossible handles", () => {
    expect(() => parseAccountInput("https://www.instagram.com/reel/DOq6eV6iIgD/")).toThrow(/not a profile/);
    expect(() => parseAccountInput("https://example.com/@someone")).toThrow(/TikTok, Instagram, YouTube, or Facebook/);
    expect(() => parseAccountInput("has spaces here", "tiktok")).toThrow(ResearchError);
    expect(() => parseAccountInput("   ")).toThrow(/Enter a handle/);
  });
});
