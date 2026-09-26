export type Sourced<T> = {
  value: T;
  source: string;
};

export type BrandExtraction = {
  companyName: Sourced<string>;
  whatTheyDo: Sourced<string>;
  products: Sourced<string>[];
  audience: Sourced<string>;
  tone: Sourced<string>;
  logoUrl: Sourced<string>;
  images: Sourced<string>[];
};

export interface BrandExtractor {
  readonly id: string;
  extract(html: string, url: string): Promise<BrandExtraction>;
}

const TONE_CUES: { tone: string; words: string[] }[] = [
  { tone: "friendly", words: ["glad", "welcome", "enjoy", "love", "easy", "we're", "we are glad"] },
  { tone: "playful", words: ["wow", "yay", "fun", "silly", "delight"] },
  { tone: "professional", words: ["enterprise", "stakeholders", "solutions", "compliance"] },
  { tone: "bold", words: ["dominate", "crush", "unleash", "fearless"] },
];

const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export function extractBrand(html: string, pageUrl: string): BrandExtraction {
  const clean = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  const companyName = pickCompany(clean);
  const whatTheyDo = pickWhatTheyDo(clean);
  const products = pickProducts(clean);
  const audience = pickAudience(clean);
  const tone = pickTone(clean, whatTheyDo);
  const images = pickImages(clean, pageUrl);
  const logoUrl = pickLogo(clean, pageUrl, images);

  return { companyName, whatTheyDo, products, audience, tone, logoUrl, images };
}

export const mockBrandExtractor: BrandExtractor = {
  id: "mock",
  extract(html, url) {
    return Promise.resolve(extractBrand(html, url));
  },
};

export type ExtractorEnv = {
  PROVIDER_MODE?: string;
  GEMINI_API_KEY?: string;
};

export function getBrandExtractor(env?: ExtractorEnv): BrandExtractor {
  const mode = env ? env.PROVIDER_MODE : process.env.PROVIDER_MODE;
  const key = (env ? env.GEMINI_API_KEY : process.env.GEMINI_API_KEY)?.trim() ?? "";
  if (mode === "live" && key) return createLiveBrandExtractor(key);
  return mockBrandExtractor;
}

export function createLiveBrandExtractor(apiKey: string): BrandExtractor {
  return {
    id: GEMINI_MODEL,
    async extract(html, url) {
      if (process.env.PROVIDER_MODE !== "live" || !apiKey.trim()) {
        return mockBrandExtractor.extract(html, url);
      }
      return extractWithGemini(html, url, apiKey.trim());
    },
  };
}

export function buildGeminiExtractRequest(html: string, pageUrl: string, apiKey: string) {
  const prompt = [
    "Extract a brand brief from this HTML page.",
    `Page URL: ${pageUrl}`,
    "Return JSON with keys companyName, whatTheyDo, products, audience, tone, logoUrl, images.",
    "products and images are arrays of strings. Use an empty string when unknown.",
    "HTML:",
    html.slice(0, 80_000),
  ].join("\n");
  return {
    url: `${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`,
    method: "POST" as const,
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    },
  };
}

async function extractWithGemini(html: string, pageUrl: string, apiKey: string): Promise<BrandExtraction> {
  const request = buildGeminiExtractRequest(html, pageUrl, apiKey);
  const response = await fetch(request.url, {
    method: request.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Gemini brand extraction failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return normalizeLive(parsed, pageUrl, extractBrand(html, pageUrl));
}

function normalizeLive(
  parsed: Record<string, unknown>,
  pageUrl: string,
  fallback: BrandExtraction,
): BrandExtraction {
  const text = (key: string, fallbackField: Sourced<string>): Sourced<string> => {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) {
      return { value: value.trim(), source: `${GEMINI_MODEL} ${key}` };
    }
    return fallbackField;
  };
  const list = (key: string, fallbackList: Sourced<string>[]): Sourced<string>[] => {
    const value = parsed[key];
    if (!Array.isArray(value)) return fallbackList;
    const items = value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => ({ value: item.trim(), source: `${GEMINI_MODEL} ${key}` }));
    return items.length > 0 ? items : fallbackList;
  };
  const logo = text("logoUrl", fallback.logoUrl);
  const absoluteLogo = absoluteHttp(logo.value, pageUrl);
  return {
    companyName: text("companyName", fallback.companyName),
    whatTheyDo: text("whatTheyDo", fallback.whatTheyDo),
    products: list("products", fallback.products),
    audience: text("audience", fallback.audience),
    tone: text("tone", fallback.tone),
    logoUrl: absoluteLogo ? { value: absoluteLogo, source: logo.source } : fallback.logoUrl,
    images: list("images", fallback.images)
      .map((image) => {
        const absolute = absoluteHttp(image.value, pageUrl);
        return absolute ? { value: absolute, source: image.source } : null;
      })
      .filter((image): image is Sourced<string> => image !== null),
  };
}

function pickCompany(html: string): Sourced<string> {
  const site = meta(html, "og:site_name");
  if (site) return { value: cleanTitle(site.content), source: site.snippet };
  const ogTitle = meta(html, "og:title");
  if (ogTitle) return { value: cleanTitle(ogTitle.content), source: ogTitle.snippet };
  const h1 = firstTag(html, "h1");
  if (h1) return { value: cleanTitle(h1.text), source: h1.snippet };
  const title = firstTag(html, "title");
  if (title) return { value: cleanTitle(title.text), source: title.snippet };
  return { value: "", source: "not found" };
}

function pickWhatTheyDo(html: string): Sourced<string> {
  const section = sectionParagraph(html, /what we do/i);
  if (section) return section;
  const description = meta(html, "description");
  if (description) return { value: description.content, source: description.snippet };
  const og = meta(html, "og:description");
  if (og) return { value: og.content, source: og.snippet };
  const paragraph = firstTag(html, "p");
  if (paragraph) return { value: paragraph.text, source: paragraph.snippet };
  return { value: "", source: "not found" };
}

function pickProducts(html: string): Sourced<string>[] {
  const region = regionAfterHeading(html, /products?/i) ?? html;
  const list = /<ul\b[^>]*>[\s\S]*?<\/ul>/i.exec(region) ?? /<ul\b[^>]*>[\s\S]*?<\/ul>/i.exec(html);
  if (!list) return [];
  const items: Sourced<string>[] = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(list[0]))) {
    const value = textOf(match[1]);
    if (value.length < 2 || value.length > 120) continue;
    items.push({ value, source: clip(match[0]) });
    if (items.length >= 12) break;
  }
  return items;
}

function pickAudience(html: string): Sourced<string> {
  for (const tag of ["p", "li", "h2", "h1"]) {
    for (const element of allTags(html, tag)) {
      if (/made for\b/i.test(element.text)) return { value: element.text, source: element.snippet };
    }
  }
  const og = meta(html, "og:description");
  if (og && /made for\b/i.test(og.content)) return { value: og.content, source: og.snippet };
  return { value: "", source: "not found" };
}

function pickTone(html: string, whatTheyDo: Sourced<string>): Sourced<string> {
  const body = textOf(html.replace(/<head\b[\s\S]*?<\/head>/i, " "));
  let best = { tone: "neutral", score: 0 };
  for (const cue of TONE_CUES) {
    const score = cue.words.reduce((sum, word) => (body.toLowerCase().includes(word) ? sum + 1 : sum), 0);
    if (score > best.score) best = { tone: cue.tone, score };
  }
  if (best.score === 0) return { value: "neutral", source: "no strong tone words" };
  const source = whatTheyDo.value ? whatTheyDo.source : "page text";
  return { value: best.tone, source };
}

function pickImages(html: string, pageUrl: string): Sourced<string>[] {
  const found: Sourced<string>[] = [];
  const seen = new Set<string>();
  const add = (value: string, source: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    found.push({ value, source });
  };
  const og = meta(html, "og:image");
  if (og) {
    const absolute = absoluteHttp(og.content, pageUrl);
    if (absolute) add(absolute, og.snippet);
  }
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const attrs = attrMap(tag);
    const absolute = absoluteHttp(attrs.src || attrs["data-src"] || "", pageUrl);
    if (absolute) add(absolute, clip(tag));
  }
  return found.slice(0, 24);
}

function pickLogo(html: string, pageUrl: string, images: Sourced<string>[]): Sourced<string> {
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const attrs = attrMap(tag);
    const hint = `${attrs.alt ?? ""} ${attrs.class ?? ""} ${attrs.id ?? ""} ${attrs.src ?? ""}`;
    if (!/logo/i.test(hint)) continue;
    const absolute = absoluteHttp(attrs.src || "", pageUrl);
    if (absolute) return { value: absolute, source: clip(tag) };
  }
  const og = meta(html, "og:image");
  if (og) {
    const absolute = absoluteHttp(og.content, pageUrl);
    if (absolute) return { value: absolute, source: og.snippet };
  }
  if (images[0]) return images[0];
  return { value: "", source: "not found" };
}

function sectionParagraph(html: string, heading: RegExp): Sourced<string> | null {
  const region = regionAfterHeading(html, heading);
  if (!region) return null;
  const paragraph = firstTag(region, "p");
  if (!paragraph) return null;
  return { value: paragraph.text, source: paragraph.snippet };
}

function regionAfterHeading(html: string, heading: RegExp): string | null {
  const re = /<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (!heading.test(textOf(match[0]))) continue;
    return html.slice(match.index + match[0].length);
  }
  return null;
}

function meta(html: string, key: string): { content: string; snippet: string } | null {
  const wanted = key.toLowerCase();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attrMap(tag);
    const name = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    if (name !== wanted) continue;
    const content = decode(attrs.content ?? "");
    if (!content) continue;
    return { content, snippet: clip(tag) };
  }
  return null;
}

function firstTag(html: string, tag: string): { text: string; snippet: string } | null {
  return allTags(html, tag)[0] ?? null;
}

function allTags(html: string, tag: string): { text: string; snippet: string }[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: { text: string; snippet: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const text = textOf(match[1]);
    if (!text) continue;
    out.push({ text, snippet: clip(match[0]) });
  }
  return out;
}

function attrMap(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) {
    attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function textOf(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decode(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)));
}

function cleanTitle(value: string): string {
  return value.replace(/\s+·\s+Torq-Pamba$/i, "").trim();
}

function absoluteHttp(value: string, pageUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function clip(snippet: string, max = 180): string {
  const oneLine = snippet.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}
