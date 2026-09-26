import { describe, expect, it } from "vitest";
import { demoSiteHtml, DEMO_AUDIENCE, DEMO_COMPANY, DEMO_PRODUCTS } from "./demoSite";
import { extractBrand, getBrandExtractor } from "./extract";

describe("extractBrand on the demo site", () => {
  const pageUrl = "http://localhost:3000/demo-site";
  const brand = extractBrand(demoSiteHtml(pageUrl), pageUrl);

  it("reads Northwind Cold Brew and keeps a source for every field", () => {
    expect(brand.companyName.value).toBe(DEMO_COMPANY);
    expect(brand.companyName.source.length).toBeGreaterThan(0);
    expect(brand.whatTheyDo.value.length).toBeGreaterThan(0);
    expect(brand.whatTheyDo.source.length).toBeGreaterThan(0);
    expect(brand.audience.value).toBe(DEMO_AUDIENCE);
    expect(brand.audience.source.length).toBeGreaterThan(0);
    expect(brand.tone.value).toBe("friendly");
    expect(brand.tone.source.length).toBeGreaterThan(0);
    expect(brand.logoUrl.value).toContain("/demo-site/og.svg");
    expect(brand.logoUrl.source.length).toBeGreaterThan(0);
  });

  it("finds the products and image sources", () => {
    expect(brand.products.map((product) => product.value)).toEqual([...DEMO_PRODUCTS]);
    for (const product of brand.products) {
      expect(product.source.length).toBeGreaterThan(0);
    }
    expect(brand.images.length).toBeGreaterThan(0);
    expect(brand.images.every((image) => image.value.startsWith("http") && image.source.length > 0)).toBe(true);
    expect(brand.images.some((image) => image.value.endsWith("/demo-site/can.svg"))).toBe(true);
  });
});

describe("brand extractor guard", () => {
  it("stays on the mock unless live mode and a Gemini key are both set", () => {
    expect(getBrandExtractor({ PROVIDER_MODE: "mock", GEMINI_API_KEY: "present" }).id).toBe("mock");
    expect(getBrandExtractor({ PROVIDER_MODE: "live", GEMINI_API_KEY: "" }).id).toBe("mock");
    expect(getBrandExtractor({ PROVIDER_MODE: "live" }).id).toBe("mock");
    expect(getBrandExtractor({ PROVIDER_MODE: "live", GEMINI_API_KEY: "test-key" }).id).toBe(
      "gemini-3.8-flash",
    );
  });
});
