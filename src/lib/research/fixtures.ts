import { hashtagsOf } from "./metrics";
import type { SocialPlatform, SourcePost, SourceTrend } from "./types";

/**
 * Sample data for the mock research source. Handles, captions and numbers are
 * invented but shaped like real short-video posts, so the pages, scoring and
 * idea generation behave the same as with a live source.
 */

type FixturePost = {
  platform: SocialPlatform;
  author: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  durationS: number;
  daysAgo: number;
  sound?: string;
};

type FixtureTrend = Omit<SourceTrend, "score" | "url">;

export type FixtureNiche = {
  key: string;
  label: string;
  keywords: RegExp;
  posts: FixturePost[];
  trends: FixtureTrend[];
};

export const FIXTURE_NICHES: readonly FixtureNiche[] = [
  {
    key: "coffee",
    label: "Coffee",
    keywords: /coffee|cold brew|espresso|latte|caf[eé]|barista|matcha/i,
    posts: [
      { platform: "tiktok", author: "brewbybea", caption: "POV: you finally stopped paying $7 for cold brew ☕ #coldbrew #coffeetok #budgethacks", views: 2_840_000, likes: 312_000, comments: 4_100, shares: 38_500, saves: 61_200, durationS: 14, daysAgo: 3, sound: "Espresso (sped up)" },
      { platform: "tiktok", author: "commutecoffee", caption: "3 mistakes you're making with oat milk cold brew. #2 ruins the texture #coldbrew #oatmilk", views: 1_190_000, likes: 98_400, comments: 2_870, shares: 9_900, saves: 27_300, durationS: 27, daysAgo: 6 },
      { platform: "instagram", author: "slowpourstudio", caption: "Day in my life running a 2-person coffee cart 🚲 #coffeecart #smallbusiness #coldbrew", views: 860_000, likes: 71_000, comments: 1_340, shares: 5_200, saves: 8_800, durationS: 42, daysAgo: 5, sound: "Espresso (sped up)" },
      { platform: "tiktok", author: "thecaffeinelab", caption: "Rating every canned cold brew at the gas station so you don't have to #coffeetok #tastetest", views: 3_470_000, likes: 401_000, comments: 12_600, shares: 22_100, saves: 18_400, durationS: 58, daysAgo: 9 },
      { platform: "youtube", author: "homebaristaclub", caption: "Why is your cold brew bitter? (it's the grind) #shorts #coldbrew", views: 640_000, likes: 31_000, comments: 980, shares: 2_100, saves: 0, durationS: 33, daysAgo: 12 },
      { platform: "instagram", author: "oatandice", caption: "Unpopular opinion: cold brew is better at 4pm than 8am #coffeetok #coldbrew", views: 410_000, likes: 22_800, comments: 3_950, shares: 1_400, saves: 900, durationS: 11, daysAgo: 2 },
      { platform: "tiktok", author: "brewbybea", caption: "How I make a week of cold brew in 5 minutes #coldbrew #mealprep #coffeetok", views: 520_000, likes: 44_100, comments: 610, shares: 3_300, saves: 21_900, durationS: 36, daysAgo: 15 },
    ],
    trends: [
      { platform: "tiktok", kind: "hashtag", label: "coffeetok", volume: 9_200_000, growthPct: 18.5 },
      { platform: "tiktok", kind: "sound", label: "Espresso (sped up)", volume: 4_100_000, growthPct: 64.2 },
      { platform: null, kind: "format", label: "Taste test", volume: 3_470_000, growthPct: 22 },
      { platform: "instagram", kind: "hashtag", label: "coldbrew", volume: 6_300_000, growthPct: 9.4 },
      { platform: null, kind: "topic", label: "Café prices vs. making it at home", volume: 2_800_000, growthPct: 41 },
    ],
  },
  {
    key: "wellness",
    label: "Wellness",
    keywords: /wellness|fitness|yoga|gym|workout|pilates|health|sleep|protein/i,
    posts: [
      { platform: "tiktok", author: "pilateswithpri", caption: "POV: 10 minutes of wall pilates fixed my posture #wallpilates #posture", views: 4_100_000, likes: 520_000, comments: 6_200, shares: 41_000, saves: 132_000, durationS: 19, daysAgo: 4, sound: "Soft reset (lofi)" },
      { platform: "instagram", author: "coachdanruns", caption: "Things I wish I knew before my first half marathon #running #halfmarathon", views: 1_320_000, likes: 88_000, comments: 2_400, shares: 7_700, saves: 31_000, durationS: 38, daysAgo: 7 },
      { platform: "youtube", author: "sleepscienceshorts", caption: "Stop scrolling before bed. Do this instead #shorts #sleep", views: 2_250_000, likes: 101_000, comments: 3_100, shares: 12_800, saves: 0, durationS: 24, daysAgo: 10 },
      { platform: "tiktok", author: "proteinpantry", caption: "Rating high-protein snacks from the corner shop #protein #tastetest #gymtok", views: 960_000, likes: 77_000, comments: 4_800, shares: 3_900, saves: 14_200, durationS: 51, daysAgo: 6 },
      { platform: "tiktok", author: "pilateswithpri", caption: "Day in my life as a pilates instructor at 5am #dayinmylife #pilates", views: 380_000, likes: 29_000, comments: 520, shares: 900, saves: 2_100, durationS: 45, daysAgo: 13, sound: "Soft reset (lofi)" },
    ],
    trends: [
      { platform: "tiktok", kind: "hashtag", label: "wallpilates", volume: 12_400_000, growthPct: 33 },
      { platform: "tiktok", kind: "sound", label: "Soft reset (lofi)", volume: 5_200_000, growthPct: 71.5 },
      { platform: null, kind: "format", label: "Things I wish I knew", volume: 1_320_000, growthPct: 15 },
      { platform: null, kind: "topic", label: "Sleep routines that are not a supplement ad", volume: 2_250_000, growthPct: 28 },
    ],
  },
  {
    key: "beauty",
    label: "Skincare & beauty",
    keywords: /skin|beauty|makeup|cosmetic|serum|spf|hair|nail/i,
    posts: [
      { platform: "tiktok", author: "dermdiaries", caption: "Stop putting vitamin C on before SPF like this ❌ #skintok #skincare", views: 5_600_000, likes: 610_000, comments: 9_400, shares: 52_000, saves: 210_000, durationS: 17, daysAgo: 2, sound: "Glow (instrumental)" },
      { platform: "instagram", author: "barefacedbeth", caption: "GRWM for a 12-hour shift with 4 products #grwm #nursesoftiktok", views: 1_740_000, likes: 132_000, comments: 2_900, shares: 6_100, saves: 22_000, durationS: 49, daysAgo: 5 },
      { platform: "tiktok", author: "budgetbeautylab", caption: "Before and after 30 days of a $9 retinol #skincare #beforeandafter", views: 2_900_000, likes: 288_000, comments: 7_700, shares: 19_400, saves: 64_000, durationS: 26, daysAgo: 8 },
      { platform: "youtube", author: "glowscience", caption: "Is double cleansing a scam? #shorts #skincare", views: 870_000, likes: 41_000, comments: 2_200, shares: 3_000, saves: 0, durationS: 31, daysAgo: 11 },
    ],
    trends: [
      { platform: "tiktok", kind: "hashtag", label: "skintok", volume: 21_000_000, growthPct: 6.1 },
      { platform: "instagram", kind: "format", label: "Get ready with me", volume: 1_740_000, growthPct: 12 },
      { platform: null, kind: "format", label: "Before and after", volume: 2_900_000, growthPct: 25.5 },
      { platform: "tiktok", kind: "sound", label: "Glow (instrumental)", volume: 3_900_000, growthPct: 48 },
    ],
  },
  {
    key: "food",
    label: "Food & snacks",
    keywords: /food|snack|recipe|bak|cook|kitchen|restaurant|meal|sauce|tea\b|juice|drink|beverage/i,
    posts: [
      { platform: "tiktok", author: "fridgefoodie", caption: "3 ingredient snack that tastes like a $12 dessert #easyrecipe #snack", views: 3_300_000, likes: 350_000, comments: 5_100, shares: 30_200, saves: 141_000, durationS: 21, daysAgo: 3, sound: "Kitchen pop" },
      { platform: "instagram", author: "smallbatchsauces", caption: "Storytime: a chef told me my hot sauce was too hot. Here's what I did #smallbusiness #storytime", views: 920_000, likes: 64_000, comments: 3_800, shares: 4_400, saves: 2_600, durationS: 55, daysAgo: 9 },
      { platform: "youtube", author: "fiveminutekitchen", caption: "How to meal prep lunches for under $20 #shorts #mealprep", views: 1_450_000, likes: 70_000, comments: 1_900, shares: 6_900, saves: 0, durationS: 40, daysAgo: 6 },
      { platform: "tiktok", author: "snackcritic", caption: "Rating viral snacks from TikTok Shop honestly #tastetest #snacks", views: 2_100_000, likes: 190_000, comments: 11_000, shares: 9_200, saves: 7_700, durationS: 57, daysAgo: 4, sound: "Kitchen pop" },
    ],
    trends: [
      { platform: "tiktok", kind: "hashtag", label: "easyrecipe", volume: 14_000_000, growthPct: 11 },
      { platform: "tiktok", kind: "sound", label: "Kitchen pop", volume: 5_400_000, growthPct: 39 },
      { platform: null, kind: "format", label: "Taste test", volume: 2_100_000, growthPct: 19 },
    ],
  },
  {
    key: "software",
    label: "Software & apps",
    keywords: /software|saas|\bapp\b|startup|tech|ai\b|productivity|developer|b2b/i,
    posts: [
      { platform: "tiktok", author: "shipitsara", caption: "POV: your whole team finds out the spreadsheet was the database #startup #techtok", views: 1_900_000, likes: 210_000, comments: 3_300, shares: 26_000, saves: 9_100, durationS: 15, daysAgo: 4, sound: "Office chaos" },
      { platform: "youtube", author: "foundernotes", caption: "3 mistakes I made pricing my SaaS #shorts #saas #startup", views: 740_000, likes: 29_000, comments: 1_600, shares: 4_800, saves: 0, durationS: 46, daysAgo: 8 },
      { platform: "instagram", author: "deskdaily", caption: "Day in my life as a solo founder (honest version) #dayinmylife #founder", views: 1_060_000, likes: 74_000, comments: 2_100, shares: 3_700, saves: 11_500, durationS: 52, daysAgo: 6 },
      { platform: "tiktok", author: "productivityjo", caption: "How I cleared 400 emails in 20 minutes #productivity #techtok", views: 2_600_000, likes: 240_000, comments: 4_400, shares: 33_000, saves: 98_000, durationS: 29, daysAgo: 2, sound: "Office chaos" },
    ],
    trends: [
      { platform: "tiktok", kind: "hashtag", label: "techtok", volume: 18_000_000, growthPct: 7.5 },
      { platform: "tiktok", kind: "sound", label: "Office chaos", volume: 4_500_000, growthPct: 55 },
      { platform: null, kind: "topic", label: "Honest founder diaries", volume: 1_060_000, growthPct: 31 },
    ],
  },
  {
    key: "pets",
    label: "Pets",
    keywords: /pet|dog|cat|puppy|kitten|vet\b|groom/i,
    posts: [
      { platform: "tiktok", author: "rescuerocco", caption: "POV: the shelter said he was 'shy' #rescuedog #dogsoftiktok", views: 6_800_000, likes: 940_000, comments: 14_000, shares: 88_000, saves: 51_000, durationS: 13, daysAgo: 3, sound: "Tiny steps" },
      { platform: "instagram", author: "groomroomgigi", caption: "Before and after: a 6-month matted doodle #doggrooming #beforeandafter", views: 2_300_000, likes: 201_000, comments: 4_900, shares: 15_000, saves: 9_800, durationS: 34, daysAgo: 7 },
      { platform: "youtube", author: "vetanswers", caption: "Never give your dog this 'healthy' snack #shorts #dogs", views: 1_700_000, likes: 88_000, comments: 5_200, shares: 21_000, saves: 0, durationS: 22, daysAgo: 9 },
    ],
    trends: [
      { platform: "tiktok", kind: "hashtag", label: "dogsoftiktok", volume: 30_000_000, growthPct: 4.2 },
      { platform: "tiktok", kind: "sound", label: "Tiny steps", volume: 6_100_000, growthPct: 82 },
      { platform: null, kind: "format", label: "Before and after", volume: 2_300_000, growthPct: 14 },
    ],
  },
];

export const DEFAULT_NICHE = FIXTURE_NICHES[0] as FixtureNiche;

/** The fixture niche that best fits a free-text niche, or null for an unfamiliar one. */
export function matchFixtureNiche(niche: string): FixtureNiche | null {
  const text = niche.trim();
  if (!text) return null;
  return FIXTURE_NICHES.find((item) => item.label.toLowerCase() === text.toLowerCase() || item.keywords.test(text)) ?? null;
}

/** Deterministic 32-bit hash, so the same handle or niche always yields the same sample numbers. */
export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function samplePostUrl(platform: SocialPlatform, author: string, id: string): string {
  if (platform === "tiktok") return `https://www.tiktok.com/@${author}/video/${id}`;
  if (platform === "instagram") return `https://www.instagram.com/reel/${id}/`;
  if (platform === "youtube") return `https://www.youtube.com/shorts/${id}`;
  return `https://www.facebook.com/reel/${id}`;
}

export function sampleId(platform: SocialPlatform, seed: string): string {
  const hash = stableHash(`${platform}:${seed}`);
  if (platform === "tiktok" || platform === "facebook") return `75${String(hash).padStart(10, "0")}${String(stableHash(seed) % 10_000_000).padStart(7, "0")}`;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let id = "";
  let value = hash;
  for (let index = 0; index < 11; index += 1) {
    id += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length) || stableHash(`${seed}:${index}`);
  }
  return id;
}

export function toSourcePost(post: FixturePost, now: Date, author = post.author): SourcePost {
  const externalId = sampleId(post.platform, `${author}:${post.caption}`);
  return {
    platform: post.platform,
    externalId,
    url: samplePostUrl(post.platform, author, externalId),
    authorHandle: author,
    caption: post.caption,
    thumbnailUrl: null,
    durationMs: post.durationS * 1000,
    postedAt: new Date(now.getTime() - post.daysAgo * 86_400_000),
    views: post.views,
    likes: post.likes,
    comments: post.comments,
    shares: post.shares,
    saves: post.platform === "youtube" ? null : post.saves,
    hashtags: hashtagsOf(post.caption),
    sound: post.sound ?? null,
  };
}

/** Posts for a niche with no fixture: generic short-video formats with the niche filled in. */
export function genericPosts(niche: string): FixturePost[] {
  const topic = niche.trim().toLowerCase() || "your niche";
  const tag = topic.replace(/[^a-z0-9]+/g, "") || "smallbusiness";
  const seed = stableHash(topic);
  const scale = (base: number, shift: number) => Math.round(base * (0.6 + ((seed >> shift) % 80) / 100));
  return [
    { platform: "tiktok", author: `${tag.slice(0, 18)}daily`, caption: `POV: you just found out how ${topic} actually works #${tag} #learnontiktok`, views: scale(1_800_000, 1), likes: scale(160_000, 2), comments: scale(2_400, 3), shares: scale(14_000, 4), saves: scale(30_000, 5), durationS: 16, daysAgo: 3 },
    { platform: "instagram", author: `the${tag.slice(0, 16)}edit`, caption: `3 mistakes everyone makes with ${topic} #${tag} #tips`, views: scale(900_000, 6), likes: scale(61_000, 7), comments: scale(1_500, 8), shares: scale(5_100, 9), saves: scale(19_000, 10), durationS: 28, daysAgo: 5 },
    { platform: "youtube", author: `${tag.slice(0, 18)}explained`, caption: `Is ${topic} worth it? Honest answer #shorts #${tag}`, views: scale(1_100_000, 11), likes: scale(47_000, 12), comments: scale(2_900, 13), shares: scale(4_200, 14), saves: 0, durationS: 35, daysAgo: 8 },
    { platform: "tiktok", author: `${tag.slice(0, 18)}daily`, caption: `Day in my life working in ${topic} #dayinmylife #${tag}`, views: scale(420_000, 15), likes: scale(31_000, 16), comments: scale(700, 17), shares: scale(1_200, 18), saves: scale(2_600, 19), durationS: 44, daysAgo: 12 },
  ];
}

export function genericTrends(niche: string): FixtureTrend[] {
  const topic = niche.trim().toLowerCase() || "your niche";
  const tag = topic.replace(/[^a-z0-9]+/g, "") || "smallbusiness";
  const seed = stableHash(topic);
  return [
    { platform: "tiktok", kind: "hashtag", label: tag, volume: 2_000_000 + (seed % 3_000_000), growthPct: 10 + (seed % 40) },
    { platform: null, kind: "format", label: "POV", volume: 1_800_000, growthPct: 21 },
    { platform: null, kind: "format", label: "Mistakes list", volume: 900_000, growthPct: 12 },
    { platform: null, kind: "topic", label: `Honest takes on ${topic}`, volume: 1_100_000, growthPct: 26 },
  ];
}
