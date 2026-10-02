export type Tier = "budget" | "standard" | "premium";
export const TIERS: readonly Tier[] = ["budget", "standard", "premium"];

type Entry = {
  id: string;
  vendor: string;
  label: string;
  /** Vendor pricing page and the date it was read. Do not invent a price. */
  source: string;
  /** Retail credits per billing unit (second, image, 1K characters, or clip for scripts). Unset until priced. */
  credits?: number;
};

export type VideoModel = Entry & {
  kind: "video";
  tier: Tier;
  usdPerSecond: number;
  maxDurationS: number;
  /**
   * Position in each tier's fallback chain; 0 is the tier default. Ties sort by
   * id, so a fractional position (1.5) inserts between neighbours without
   * editing them. Models without `chains` are alternatives only.
   */
  chains?: Partial<Record<Tier, number>>;
  /** Lip-sync avatar engines: scene frames they need and the voice model priced with them. */
  avatar?: { frames: number; voiceModel: string };
};

/** Script LLM. `tier` marks the model the cost estimate uses for that tier. */
export type ScriptModel = Entry & { kind: "script"; tier?: Tier; inputUsdPer1M: number; outputUsdPer1M: number };

/** Start-frame image model. `tier` marks the model the cost estimate uses for that tier. */
export type ImageModel = Entry & { kind: "image"; tier?: Tier; usdPerImage: number };

export type VoiceModel = Entry & { kind: "voice"; usdPer1KChars: number; voiceOverDefault?: boolean };

export type ModelConfig = VideoModel | ScriptModel | ImageModel | VoiceModel;
export type ModelKind = ModelConfig["kind"];
export type ModelOfKind<K extends ModelKind> = Extract<ModelConfig, { kind: K }>;
