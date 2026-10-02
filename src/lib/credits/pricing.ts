/**
 * Credit prices, derived from the model catalog. Pure, safe in client components.
 *
 * One credit retails at $0.01 (Hobby: $16 for 1,600; Pro: $100 for 10,000).
 * A catalog entry may set `credits` per billing unit; an entry without one is
 * priced at its list cost times `CREDIT_MARKUP`, so a model added on another
 * branch is never free. Each line item rounds up to a whole credit once.
 */
import { catalog, type ModelConfig, type Tier } from "@/lib/models";
import {
  FRAMES_PER_CLIP,
  SCRIPT_INPUT_TOKENS,
  SCRIPT_OUTPUT_TOKENS,
  TIER_MODEL,
  VOICE_CHARS_PER_30S,
} from "@/lib/pricing";

export const USD_PER_CREDIT = 0.01;
export const CREDIT_MARKUP = 1.5;

/** List price in USD for one billing unit: a second of video, an image, 1K characters, or one clip's script. */
export function unitCostUsd(model: ModelConfig): number {
  switch (model.kind) {
    case "video":
      return model.usdPerSecond;
    case "image":
      return model.usdPerImage;
    case "voice":
      return model.usdPer1KChars;
    case "script":
      return (SCRIPT_INPUT_TOKENS * model.inputUsdPer1M + SCRIPT_OUTPUT_TOKENS * model.outputUsdPer1M) / 1_000_000;
  }
}

/** Credits for one billing unit. May be fractional; `lineCredits` rounds the line up. */
export function creditsPerUnit(model: ModelConfig): number {
  return model.credits ?? (unitCostUsd(model) / USD_PER_CREDIT) * CREDIT_MARKUP;
}

/** Whole credits for `units` of a model, rounded up once. Rounding to 6 places first drops float noise. */
export function lineCredits(model: ModelConfig, units: number): number {
  if (units <= 0) return 0;
  return Math.ceil(Math.round(creditsPerUnit(model) * units * 1e6) / 1e6);
}

export type ClipCredits = {
  script: number;
  frames: number;
  video: number;
  voice: number;
  total: number;
};

function avatarEngine(id: string | undefined): string | null {
  return id && catalog.isVideo(id) && catalog.video(id).avatar ? id : null;
}

function voiceCredits(durationS: number, voiceModel: string): number {
  return lineCredits(catalog.voice(voiceModel), (VOICE_CHARS_PER_30S * (durationS / 30)) / 1000);
}

/** Same line items as `estimateClipCost`, in whole credits. This is the price shown before Generate. */
export function quoteClipCredits(input: {
  tier: Tier;
  durationS: number;
  model?: string;
  voiceOver?: boolean;
  avatarEngine?: string;
}): ClipCredits {
  const durationS = Math.max(0, input.durationS);
  const avatar = avatarEngine(input.avatarEngine) ?? avatarEngine(input.model);
  const model = avatar ?? (catalog.isVideo(input.model) ? input.model : TIER_MODEL[input.tier]);
  const plan = avatar ? catalog.video(avatar).avatar : undefined;
  const frameCount = plan ? plan.frames : FRAMES_PER_CLIP;
  const voiceOver = input.voiceOver ?? Boolean(plan);

  const script = lineCredits(catalog.scriptModel(input.tier), 1);
  const frames = lineCredits(catalog.frameModel(input.tier), frameCount);
  const video = lineCredits(catalog.video(model), durationS);
  const voice = voiceOver ? voiceCredits(durationS, plan?.voiceModel ?? catalog.voiceOver().id) : 0;
  return { script, frames, video, voice, total: script + frames + video + voice };
}

/**
 * What the scenes cost once the fallback chain has picked a model for each.
 * Scenes on the same model are summed before rounding, so one model across
 * every scene costs exactly the quote.
 */
export function creditsForScenes(tier: Tier, scenes: { durationS: number; model: string }[], voiceOver = false): number {
  const fixed = quoteClipCredits({ tier, durationS: 0, voiceOver: false });
  const secondsByModel = new Map<string, number>();
  for (const scene of scenes) {
    const model = catalog.isVideo(scene.model) ? scene.model : TIER_MODEL[tier];
    secondsByModel.set(model, (secondsByModel.get(model) ?? 0) + scene.durationS);
  }
  let video = 0;
  for (const [model, seconds] of secondsByModel) video += lineCredits(catalog.video(model), seconds);
  const durationS = scenes.reduce((sum, scene) => sum + scene.durationS, 0);
  const voice = voiceOver ? voiceCredits(durationS, catalog.voiceOver().id) : 0;
  return fixed.script + fixed.frames + video + voice;
}

export function formatCredits(credits: number): string {
  const rounded = Math.trunc(credits);
  return `${rounded.toLocaleString("en-US")} ${Math.abs(rounded) === 1 ? "credit" : "credits"}`;
}
