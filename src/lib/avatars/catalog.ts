import { portraitSvg, type PortraitSpec } from "./portrait";

export const STOCK_VOICES = [
  { id: "warm-alto", label: "Warm alto" },
  { id: "clear-baritone", label: "Clear baritone" },
  { id: "bright-mezzo", label: "Bright mezzo" },
  { id: "friendly-tenor", label: "Friendly tenor" },
  { id: "soft-alto", label: "Soft alto" },
  { id: "steady-baritone", label: "Steady baritone" },
  { id: "bright-soprano", label: "Bright soprano" },
  { id: "warm-tenor", label: "Warm tenor" },
] as const;

export type StockAvatar = {
  id: string;
  name: string;
  look: string;
  keywords: string[];
  voiceId: string;
  spec: PortraitSpec;
  svg: string;
};

function stock(
  input: Omit<StockAvatar, "svg">,
): StockAvatar {
  return { ...input, svg: portraitSvg(input.spec, input.name, input.id) };
}

export const STOCK_AVATARS: StockAvatar[] = [
  stock({
    id: "mina-cole",
    name: "Mina Cole",
    look: "Warm medium skin, dark hair in a bun, olive shirt, calm half-smile.",
    keywords: ["coffee", "cafe", "brew", "barista", "beverage"],
    voiceId: "warm-alto",
    spec: { skin: "#C68642", hair: "#241910", hairStyle: "bun", shirt: "#3E6B52", background: "#E7EFEA", eye: "#241C18" },
  }),
  stock({
    id: "jonas-reed",
    name: "Jonas Reed",
    look: "Light skin, short sandy hair, navy shirt, easy city posture.",
    keywords: ["commute", "transit", "city", "office", "remote", "productivity"],
    voiceId: "clear-baritone",
    spec: { skin: "#F1C7A6", hair: "#C4A574", hairStyle: "short", shirt: "#1F4E79", background: "#E6EEF5", eye: "#241C18" },
  }),
  stock({
    id: "asha-raman",
    name: "Asha Raman",
    look: "Deep brown skin, long black hair, terracotta shirt, steady gaze.",
    keywords: ["wellness", "fitness", "health", "yoga", "outdoor"],
    voiceId: "bright-mezzo",
    spec: { skin: "#6B3E26", hair: "#1A120E", hairStyle: "long", shirt: "#8C4A3A", background: "#F8EDE6", eye: "#F6E7DC" },
  }),
  stock({
    id: "leo-martins",
    name: "Leo Martins",
    look: "Olive skin, dark curly hair, teal shirt, bright open face.",
    keywords: ["tech", "software", "saas", "startup", "gadget"],
    voiceId: "friendly-tenor",
    spec: { skin: "#E0AA7A", hair: "#3B2416", hairStyle: "curly", shirt: "#1F6F78", background: "#E5F2F2", eye: "#241C18" },
  }),
  stock({
    id: "priya-shah",
    name: "Priya Shah",
    look: "Light brown skin, black bob, gold shirt, quiet smile.",
    keywords: ["beauty", "skincare", "fashion", "cosmetics"],
    voiceId: "soft-alto",
    spec: { skin: "#A56B3C", hair: "#1C1C1C", hairStyle: "bob", shirt: "#C4A574", background: "#F7F0E4", eye: "#241C18" },
  }),
  stock({
    id: "evan-brooks",
    name: "Evan Brooks",
    look: "Fair skin, short brown hair, indigo shirt, even expression.",
    keywords: ["finance", "business", "consulting", "b2b"],
    voiceId: "steady-baritone",
    spec: { skin: "#F6D7C3", hair: "#6B4A2B", hairStyle: "buzz", shirt: "#3D4C7A", background: "#EEEAF6", eye: "#241C18" },
  }),
  stock({
    id: "noor-elsayed",
    name: "Noor El-Sayed",
    look: "Medium brown skin, black pixie cut, teal shirt, attentive eyes.",
    keywords: ["education", "tutor", "learning", "course"],
    voiceId: "bright-soprano",
    spec: { skin: "#8D5524", hair: "#111111", hairStyle: "pixie", shirt: "#245C6B", background: "#E7F0F2", eye: "#241C18" },
  }),
  stock({
    id: "sam-okonkwo",
    name: "Sam Okonkwo",
    look: "Deep skin, short waves, green shirt, warm presence.",
    keywords: ["home", "kitchen", "recipe", "cooking", "family"],
    voiceId: "warm-tenor",
    spec: { skin: "#4E3424", hair: "#1A120E", hairStyle: "waves", shirt: "#2F6B45", background: "#E9F3EA", eye: "#F6E7DC" },
  }),
];

export function getStockAvatar(id: string): StockAvatar | undefined {
  return STOCK_AVATARS.find((avatar) => avatar.id === id);
}

export function voiceLabel(voiceId: string): string {
  return STOCK_VOICES.find((voice) => voice.id === voiceId)?.label ?? voiceId;
}

export function shortlist(niche: string, limit = 3): StockAvatar[] {
  const ranked = STOCK_AVATARS.map((avatar, index) => ({
    avatar,
    index,
    score: scoreNiche(niche, avatar.keywords),
  }));
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, limit).map((row) => row.avatar);
}

function scoreNiche(niche: string, keywords: string[]): number {
  const hay = niche.toLowerCase();
  const tokens = hay.split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
  let score = 0;
  for (const keyword of keywords) {
    const needle = keyword.toLowerCase();
    if (hasWord(hay, needle)) {
      score += 2;
      continue;
    }
    const stem = needle.slice(0, 5);
    if (stem.length >= 4 && tokens.some((token) => token.startsWith(stem))) score += 1;
  }
  return score;
}

function hasWord(hay: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(hay);
}
