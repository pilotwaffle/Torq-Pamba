import { createHash } from "node:crypto";
import { GROK_IMAGINE_IMAGE_USD } from "@/lib/pricing";
import { STOCK_VOICES } from "./catalog";
import { HAIR_STYLES, portraitSvg, type PortraitSpec } from "./portrait";

const SKINS = ["#F6D7C3", "#F1C7A6", "#E0AA7A", "#C68642", "#A56B3C", "#8D5524", "#6B3E26", "#4E3424"];
const HAIRS = ["#1A120E", "#3B2416", "#6B4A2B", "#C4A574", "#4A3428", "#202020"];
const SHIRTS = ["#3E6B52", "#1F4E79", "#8C4A3A", "#1F6F78", "#3D4C7A", "#245C6B", "#2F6B45", "#7A4E2D"];
const BACKGROUNDS = ["#E7EFEA", "#E6EEF5", "#F8EDE6", "#E5F2F2", "#F7F0E4", "#EEEAF6", "#E7F0F2", "#E9F3EA"];

export type GeneratedAvatar = {
  name: string;
  look: string;
  voiceId: string;
  spec: PortraitSpec;
  svg: string;
  seed: string;
  costUsd: number;
};

export function generateAvatar(description: string): GeneratedAvatar {
  const look = description.trim();
  if (!look) throw new Error("Describe your avatar");
  const hash = createHash("sha256").update(look).digest();
  const skin = SKINS[hash[0] % SKINS.length] ?? SKINS[0];
  const spec: PortraitSpec = {
    skin,
    hair: HAIRS[hash[1] % HAIRS.length] ?? HAIRS[0],
    hairStyle: HAIR_STYLES[hash[2] % HAIR_STYLES.length] ?? "short",
    shirt: SHIRTS[hash[3] % SHIRTS.length] ?? SHIRTS[0],
    background: BACKGROUNDS[hash[4] % BACKGROUNDS.length] ?? BACKGROUNDS[0],
    eye: luminance(skin) < 140 ? "#F6E7DC" : "#241C18",
  };
  const seed = hash.subarray(0, 8).toString("hex");
  const name = `Custom ${hash.subarray(0, 2).toString("hex")}`;
  const voiceId = STOCK_VOICES[hash[5] % STOCK_VOICES.length]?.id ?? STOCK_VOICES[0].id;
  return {
    name,
    look,
    voiceId,
    spec,
    svg: portraitSvg(spec, name, seed),
    seed,
    costUsd: GROK_IMAGINE_IMAGE_USD,
  };
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return (r + g + b) / 3;
}
