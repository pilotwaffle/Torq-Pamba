import type { SourcePost, SourceTrend } from "./types";

export function median(values: readonly number[]): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Views divided by the median views of the batch (the author's recent posts, or one discover pull). */
export function outlierScores(posts: readonly Pick<SourcePost, "views">[]): number[] {
  const base = median(posts.map((post) => post.views ?? 0).filter((views) => views > 0));
  return posts.map((post) => (base > 0 && post.views ? round2(post.views / base) : 0));
}

/** (likes + comments + shares + saves) / views, as a percentage. */
export function engagementRate(post: Pick<SourcePost, "views" | "likes" | "comments" | "shares" | "saves">): number {
  if (!post.views) return 0;
  const actions = (post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0) + (post.saves ?? 0);
  return round2((actions / post.views) * 100);
}

/** The opening line of a caption, without hashtags, capped at 120 characters. */
export function extractHook(caption: string | null): string | null {
  if (!caption) return null;
  const line = caption
    .split(/\r?\n/)
    .map((part) => part.replace(/#[\p{L}\p{N}_]+/gu, "").trim())
    .find(Boolean);
  if (!line) return null;
  const sentence = line.match(/^(.{8,120}?[.!?…])(?:\s|$)/u)?.[1] ?? line;
  return sentence.length > 120 ? `${sentence.slice(0, 117).trimEnd()}…` : sentence;
}

export function hashtagsOf(caption: string | null): string[] {
  if (!caption) return [];
  const tags = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(tags.map((tag) => tag.slice(1).toLowerCase()))];
}

const FORMATS: { label: string; test: RegExp }[] = [
  { label: "POV", test: /\bpov\b/i },
  { label: "Day in the life", test: /\bday in (?:the|my) life\b/i },
  { label: "Get ready with me", test: /\bgrwm\b|\bget ready with me\b/i },
  { label: "Things I wish I knew", test: /\b(?:wish i(?:'d| had)? known|wish i knew)\b/i },
  { label: "Mistakes list", test: /\bmistakes?\b/i },
  { label: "Before and after", test: /\bbefore (?:and|&|vs\.?) after\b/i },
  { label: "Storytime", test: /\bstory ?time\b/i },
  { label: "Taste test", test: /\btaste test\b|\btrying\b|\brating\b/i },
  { label: "Tutorial", test: /\bhow (?:to|i)\b|\brecipe\b|\btutorial\b|\bstep\b/i },
  { label: "Unpopular opinion", test: /\bunpopular opinion\b|\bhot take\b/i },
];

export function formatsOf(caption: string | null): string[] {
  if (!caption) return [];
  return FORMATS.filter((format) => format.test.test(caption)).map((format) => format.label);
}

/**
 * Short, deterministic notes on why a post outperformed: reach against the
 * baseline, the opening hook, length, and which actions viewers took.
 */
export function whyItWorked(post: SourcePost, outlier: number): string[] {
  const notes: string[] = [];
  if (outlier >= 2) notes.push(`${formatMultiple(outlier)} the usual views for this set of posts.`);
  const hook = extractHook(post.caption);
  if (hook) {
    if (/\?$/.test(hook)) notes.push("Opens on a question, so viewers stay for the answer.");
    else if (/^\d|\b\d+ (?:things|ways|mistakes|tips|reasons)\b/i.test(hook)) notes.push("Numbered hook promises a payoff.");
    else if (/\bpov\b/i.test(hook)) notes.push("POV framing puts the viewer inside the scene.");
    else if (/\b(?:stop|never|don't|don’t|wrong)\b/i.test(hook)) notes.push("Pattern-interrupt hook challenges a habit.");
  }
  const seconds = post.durationMs ? post.durationMs / 1000 : null;
  if (seconds !== null && seconds <= 20) notes.push(`Short (${Math.round(seconds)}s), so it gets rewatched.`);
  if (post.views) {
    const shareRate = (post.shares ?? 0) / post.views;
    const saveRate = (post.saves ?? 0) / post.views;
    const commentRate = (post.comments ?? 0) / post.views;
    if (saveRate >= 0.01) notes.push("High save rate: people keep it as a reference.");
    if (shareRate >= 0.008) notes.push("High share rate: viewers send it to someone.");
    if (commentRate >= 0.004) notes.push("Comment-heavy: it invites replies.");
  }
  const formats = formatsOf(post.caption);
  if (formats[0]) notes.push(`Uses the ${formats[0]} format.`);
  if (post.sound) notes.push(`Rides the sound “${post.sound}”.`);
  return notes.slice(0, 4);
}

/**
 * Trends from a batch of posts: hashtags and sounds weighted by views, plus
 * recognisable formats. Growth needs a previous observation, so it is null here.
 */
export function deriveTrends(posts: readonly SourcePost[], limit = 8): SourceTrend[] {
  const tally = new Map<string, SourceTrend>();
  const counts = new Map<string, number>();
  function add(kind: SourceTrend["kind"], label: string, post: SourcePost) {
    const key = `${kind}:${label.toLowerCase()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const found = tally.get(key);
    if (found) {
      found.volume = (found.volume ?? 0) + (post.views ?? 0);
      return;
    }
    tally.set(key, {
      platform: post.platform,
      kind,
      label,
      volume: post.views ?? 0,
      growthPct: null,
      score: null,
      url: kind === "hashtag" && post.platform === "tiktok" ? `https://www.tiktok.com/tag/${encodeURIComponent(label)}` : null,
    });
  }
  for (const post of posts) {
    for (const tag of post.hashtags.length ? post.hashtags : hashtagsOf(post.caption)) add("hashtag", tag, post);
    if (post.sound && !/^original (?:sound|audio)/i.test(post.sound)) add("sound", post.sound, post);
    for (const format of formatsOf(post.caption)) add("format", format, post);
  }
  // A hashtag or sound on one post is noise; a format counts once it shows up at all.
  const rows = [...tally.entries()]
    .filter(([key, row]) => (counts.get(key) ?? 0) >= 2 || row.kind === "format")
    .map(([, row]) => row);
  const top = Math.max(1, ...rows.map((row) => row.volume ?? 0));
  return rows
    .map((row) => ({ ...row, score: round2(((row.volume ?? 0) / top) * 100) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

export function growthPct(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous <= 0) return null;
  return round2(((current - previous) / previous) * 100);
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return String(value);
}

function formatMultiple(value: number): string {
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}×`;
}

function trim(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
