import { z } from "zod";
import type { BrandBrief } from "@/db/schema";

export type IdeaDraft = {
  title: string;
  hook: string;
  angle: string;
  source: "agent" | "viral_post" | "trend";
  viralPostId: string | null;
  trendId: string | null;
};

export type IdeaPost = {
  id: string;
  platform: string;
  authorHandle: string | null;
  hook: string | null;
  caption: string | null;
  views: number | null;
  outlierScore: number | null;
  notes: string[];
};

export type IdeaTrend = { id: string; kind: string; label: string; growthPct: number | null };

export type IdeaContext = {
  brief: BrandBrief | null;
  niche: string;
  posts: IdeaPost[];
  trends: IdeaTrend[];
  /** True when ideas are asked for from one post or trend, so brief-only filler is left out. */
  seeded?: boolean;
};

function brand(ctx: IdeaContext) {
  const brief = ctx.brief ?? {};
  const company = brief.companyName?.trim() || "your brand";
  const product = brief.products?.find((item) => item.trim())?.trim() || brief.companyName?.trim() || ctx.niche;
  const audience = brief.audience?.trim().replace(/\.$/, "") || `people into ${ctx.niche.toLowerCase()}`;
  return { company, product, audience };
}

export function ideaPrompt(ctx: IdeaContext, count: number): { system: string; user: string } {
  const { company, product, audience } = brand(ctx);
  const brief = ctx.brief ?? {};
  const system = [
    "You turn short-video research into UGC video ideas for one brand.",
    "Each idea borrows the structure of what worked (hook, format, sound, topic) without copying anyone's words.",
    "Do not suggest buying followers, fake reviews, or posting from other people's accounts.",
    'Reply with only a JSON array. Each item: {"title": string (max 80 chars), "hook": string (the first spoken line, max 120 chars), "angle": string (one sentence on why it fits the brand), "basis": "post N" | "trend N" | null}.',
  ].join(" ");
  const lines = [
    `Brand: ${company}`,
    brief.whatTheyDo ? `What they do: ${brief.whatTheyDo}` : null,
    `Product: ${product}`,
    `Audience: ${audience}`,
    brief.tone ? `Tone: ${brief.tone}` : null,
    `Niche: ${ctx.niche}`,
    "",
    "Posts that outperformed:",
    ...ctx.posts.map(
      (post, index) =>
        `post ${index + 1}: [${post.platform}] @${post.authorHandle ?? "unknown"} — “${(post.hook ?? post.caption ?? "").slice(0, 160)}” (${post.outlierScore ?? "?"}× baseline). ${post.notes.slice(0, 2).join(" ")}`,
    ),
    "",
    "Trends:",
    ...ctx.trends.map(
      (trend, index) =>
        `trend ${index + 1}: ${trend.kind} “${trend.label}”${trend.growthPct != null ? ` (${trend.growthPct > 0 ? "+" : ""}${trend.growthPct}%)` : ""}`,
    ),
    "",
    `Write ${count} distinct ideas.`,
  ];
  return { system, user: lines.filter((line) => line !== null).join("\n") };
}

const llmIdea = z.object({
  title: z.string().trim().min(3).max(200),
  hook: z.string().trim().max(400).optional().default(""),
  angle: z.string().trim().max(600).optional().default(""),
  basis: z.string().trim().nullish(),
});

/** Reads the model's JSON array. Items that do not validate are dropped; `basis` maps back to the post or trend id. */
export function parseIdeaResponse(text: string, ctx: IdeaContext): IdeaDraft[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const drafts: IdeaDraft[] = [];
  for (const item of raw) {
    const parsed = llmIdea.safeParse(item);
    if (!parsed.success) continue;
    const basis = parsed.data.basis?.match(/^(post|trend)\s*#?\s*(\d+)$/i);
    const index = basis ? Number(basis[2]) - 1 : -1;
    const post = basis?.[1]?.toLowerCase() === "post" ? ctx.posts[index] : undefined;
    const trend = basis?.[1]?.toLowerCase() === "trend" ? ctx.trends[index] : undefined;
    drafts.push({
      title: clip(parsed.data.title, 80),
      hook: clip(parsed.data.hook, 120),
      angle: clip(parsed.data.angle, 300),
      source: post ? "viral_post" : trend ? "trend" : "agent",
      viralPostId: post?.id ?? null,
      trendId: trend?.id ?? null,
    });
  }
  return drafts;
}

/** Rewrites a winning hook's structure around the brand's product. */
export function adaptHook(hook: string | null, product: string, audience: string): string {
  const text = hook?.trim() ?? "";
  const numbered = text.match(/^(\d+)\s+(mistakes|things|ways|tips|reasons)\b/i);
  if (numbered) return `${numbered[1]} ${numbered[2]?.toLowerCase()} people make with ${product}`;
  if (/^pov\b/i.test(text)) return `POV: you just switched to ${product}`;
  if (/^(?:stop|never|don't|don’t)\b/i.test(text)) return `Stop doing this if you care about ${product}`;
  if (/^rating\b|taste test/i.test(text)) return `Rating ${product} honestly, no sponsor script`;
  if (/^day in (?:my|the) life/i.test(text)) return `Day in the life of someone who swears by ${product}`;
  if (/^how (?:i|to)\b/i.test(text)) return `How I use ${product} in under a minute`;
  if (/\?$/.test(text)) return `Is ${product} actually worth it?`;
  if (/^unpopular opinion|hot take/i.test(text)) return `Unpopular opinion about ${product}`;
  if (/^before and after/i.test(text)) return `Before and after a week of ${product}`;
  return `What ${audience} get wrong about ${product}`;
}

const FORMAT_HOOKS: Record<string, (product: string, audience: string) => string> = {
  pov: (product) => `POV: you just switched to ${product}`,
  "day in the life": (product) => `Day in the life with ${product}`,
  "get ready with me": (product) => `Get ready with me, featuring ${product}`,
  "things i wish i knew": (product) => `Things I wish I knew before trying ${product}`,
  "mistakes list": (product) => `3 mistakes people make with ${product}`,
  "before and after": (product) => `Before and after a week of ${product}`,
  storytime: (product) => `Storytime: how ${product} actually started`,
  "taste test": (product) => `Rating ${product} honestly, no sponsor script`,
  tutorial: (product) => `How to get the most out of ${product}`,
  "unpopular opinion": (product, audience) => `Unpopular opinion: ${audience} should rethink ${product}`,
};

/** Ideas without a model: one per trend and per standout post, interleaved, then deduplicated. */
export function templateIdeas(ctx: IdeaContext, count: number): IdeaDraft[] {
  const { company, product, audience } = brand(ctx);
  const fromTrends: IdeaDraft[] = ctx.trends.map((trend) => {
    const label = trend.label;
    if (trend.kind === "format") {
      const hook = FORMAT_HOOKS[label.toLowerCase()]?.(product, audience) ?? `${label}: ${product} edition`;
      return {
        title: `${label} with ${product}`,
        hook,
        angle: `The ${label} format is ${growthText(trend)} in ${ctx.niche.toLowerCase()}; ${company} fits it with a real product moment.`,
        source: "trend",
        viralPostId: null,
        trendId: trend.id,
      };
    }
    if (trend.kind === "sound") {
      return {
        title: `${product} cut to “${label}”`,
        hook: `Watch what happens to ${product} on the beat`,
        angle: `“${label}” is ${growthText(trend)}; a fast product reveal timed to the sound rides that reach.`,
        source: "trend",
        viralPostId: null,
        trendId: trend.id,
      };
    }
    if (trend.kind === "hashtag") {
      return {
        title: `#${label}: the ${product} take`,
        hook: `Everyone on #${label} is missing this about ${product}`,
        angle: `#${label} is ${growthText(trend)}; join the conversation with a ${company} point of view instead of a product ad.`,
        source: "trend",
        viralPostId: null,
        trendId: trend.id,
      };
    }
    return {
      title: `${company} on “${label}”`,
      hook: `Here’s our honest take on ${label.toLowerCase()}`,
      angle: `“${label}” is ${growthText(trend)}; ${audience} are already watching it.`,
      source: "trend",
      viralPostId: null,
      trendId: trend.id,
    };
  });
  const fromPosts: IdeaDraft[] = ctx.posts.map((post) => {
    const author = post.authorHandle ? `@${post.authorHandle}` : "a top post";
    const reason = post.notes[0]?.replace(/\.$/, "").toLowerCase() ?? "it outperformed";
    const hook = adaptHook(post.hook ?? post.caption, product, audience);
    return {
      title: hook.length <= 80 ? hook : `${product}, the ${author} way`,
      hook,
      angle: `Borrows the structure of ${author}'s post (${reason}) and points it at ${product} for ${audience}.`,
      source: "viral_post",
      viralPostId: post.id,
      trendId: null,
    };
  });
  const mixed: IdeaDraft[] = [];
  for (let index = 0; index < Math.max(fromTrends.length, fromPosts.length); index += 1) {
    if (fromPosts[index]) mixed.push(fromPosts[index] as IdeaDraft);
    if (fromTrends[index]) mixed.push(fromTrends[index] as IdeaDraft);
  }
  // Second takes on each post and trend, then brief-only ideas once research runs out.
  for (const post of ctx.posts) {
    const author = post.authorHandle ? `@${post.authorHandle}` : "a top post";
    mixed.push({
      title: `The ${author} format, starring ${product}`,
      hook: `We tried the format behind ${author}'s ${post.outlierScore ? `${post.outlierScore}× ` : ""}post with ${product}`,
      angle: `Same structure and pacing as ${author}'s post, with ${company}'s product as the payoff.`,
      source: "viral_post",
      viralPostId: post.id,
      trendId: null,
    });
  }
  for (const trend of ctx.trends) {
    const label = trend.kind === "hashtag" ? `#${trend.label}` : trend.label;
    mixed.push({
      title: `${label}, ${audience} edition`,
      hook: `If you’re one of the ${audience} seeing ${label} everywhere, this one’s for you`,
      angle: `Narrows ${label} to ${audience}, so it reads as made for them rather than a generic trend video.`,
      source: "trend",
      viralPostId: null,
      trendId: trend.id,
    });
  }
  if (!ctx.seeded) {
    for (const [title, hook] of evergreen(company, product, audience)) {
      mixed.push({ title, hook, angle: `A brief-based idea for ${company}, no trend needed.`, source: "agent", viralPostId: null, trendId: null });
    }
  }
  return dedupeDrafts(mixed).slice(0, count);
}

export function dedupeDrafts(drafts: IdeaDraft[], existing: readonly string[] = []): IdeaDraft[] {
  const seen = new Set(existing.map((title) => title.trim().toLowerCase()));
  return drafts.filter((draft) => {
    const key = draft.title.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evergreen(company: string, product: string, audience: string): [string, string][] {
  return [
    [`How ${audience} actually use ${product}`, `Here’s how ${audience} actually use ${product}`],
    [`Myth vs. fact: ${product}`, `You’ve been told the wrong thing about ${product}`],
    [`First reaction to ${product}`, `Trying ${product} for the first time, on camera`],
    [`${product} vs. the usual option`, `Is ${product} better than what you’re using now?`],
    [`3 ways to use ${product}`, `3 ways to use ${product} you haven’t tried`],
    [`Behind the scenes at ${company}`, `Here’s how ${product} is actually made`],
    [`The question we get most`, `The question we get asked most about ${product}`],
    [`My 30-second ${product} routine`, `My 30-second ${product} routine, start to finish`],
  ];
}

function growthText(trend: IdeaTrend): string {
  if (trend.growthPct == null) return "showing up a lot";
  if (trend.growthPct > 0) return `up ${Math.round(trend.growthPct)}%`;
  return "steady";
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
