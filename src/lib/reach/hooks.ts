import { limit, normalizePhrase } from "@/lib/agent/copy";

/**
 * Hook-variant generation. A variant changes only the opening hook (the first
 * on-screen line); the clips stay the same, so a hook test costs no extra
 * generation. Patterns are plain templates so results are reproducible in mock
 * mode; proven patterns from Knowledge are tried first.
 */

export const HOOK_MAX_CHARS = 60;

export const HOOK_PATTERNS = {
  question: ({ product }: HookInput) => `Is ${product} actually worth it?`,
  pov: ({ product }: HookInput) => `POV: you finally found ${product}.`,
  number: ({ product }: HookInput) => `3 seconds. That's all ${product} takes.`,
  contrarian: ({ product }: HookInput) => `Unpopular opinion: ${product} beats the usual fix.`,
  proof: ({ product, audience }: HookInput) => `Why ${audience} keep buying ${product}.`,
  before_after: ({ product }: HookInput) => `My day before ${product} vs after.`,
  curiosity: ({ company }: HookInput) => `Nobody talks about this ${company} trick.`,
} as const;

export type HookPattern = keyof typeof HOOK_PATTERNS;
export type HookInput = { product: string; audience: string; company: string };
export type HookVariantDraft = { label: string; pattern: HookPattern | "control"; hook: string };

export const PATTERN_LABEL: Record<HookPattern | "control", string> = {
  control: "Original hook",
  question: "Question",
  pov: "POV",
  number: "Number",
  contrarian: "Contrarian",
  proof: "Social proof",
  before_after: "Before / after",
  curiosity: "Curiosity gap",
};

/** Claims a hook must not make: they break platform ad and branded-content policies. */
const BANNED: [RegExp, string][] = [
  [/\bguarantee(d|s)?\b/i, "guarantee"],
  [/\bcure(s|d)?\b/i, "cure"],
  [/\b100\s?%/i, "100%"],
  [/\brisk[- ]free\b/i, "risk-free"],
  [/\bmiracle\b/i, "miracle"],
  [/\bget rich\b/i, "get rich"],
  [/\bfree money\b/i, "free money"],
  [/\bclick (the )?link\b/i, "click the link"],
];

export function hookPolicyIssues(hook: string): string[] {
  const issues: string[] = [];
  const clean = hook.trim();
  if (!clean) issues.push("Hook is empty");
  if (clean.length > HOOK_MAX_CHARS) issues.push(`Hook is longer than ${HOOK_MAX_CHARS} characters`);
  for (const [pattern, name] of BANNED) if (pattern.test(clean)) issues.push(`Hook makes a claim platforms reject ("${name}")`);
  return issues;
}

export function isHookPattern(value: unknown): value is HookPattern {
  return typeof value === "string" && Object.hasOwn(HOOK_PATTERNS, value);
}

function cleanInput(input: HookInput): HookInput {
  return {
    product: normalizePhrase(input.product) || "this",
    audience: (normalizePhrase(input.audience) || "busy people").toLowerCase(),
    company: normalizePhrase(input.company) || "brand",
  };
}

/**
 * Variant A is always the control (the base video's own hook). B, C, … use the
 * preferred (proven) patterns first, then the default order, skipping any hook
 * that duplicates another or fails policy.
 */
export function generateHookVariants(input: HookInput & { baseHook: string; count: number; preferPatterns?: string[] }): HookVariantDraft[] {
  const count = Math.min(5, Math.max(2, Math.round(input.count)));
  const fields = cleanInput(input);
  const control = limit(input.baseHook, HOOK_MAX_CHARS) || "Watch this.";
  const out: HookVariantDraft[] = [{ label: "A", pattern: "control", hook: control }];
  const seen = new Set([control.toLowerCase()]);
  const order: HookPattern[] = [];
  for (const pattern of input.preferPatterns ?? []) if (isHookPattern(pattern) && !order.includes(pattern)) order.push(pattern);
  for (const pattern of Object.keys(HOOK_PATTERNS) as HookPattern[]) if (!order.includes(pattern)) order.push(pattern);
  for (const pattern of order) {
    if (out.length >= count) break;
    const hook = limit(HOOK_PATTERNS[pattern](fields), HOOK_MAX_CHARS);
    if (!hook || seen.has(hook.toLowerCase()) || hookPolicyIssues(hook).length > 0) continue;
    seen.add(hook.toLowerCase());
    out.push({ label: String.fromCharCode(65 + out.length), pattern, hook });
  }
  return out;
}

/** The variant's captions: the hook as an on-screen line over the first ~2 s, then the spoken captions. */
export function captionsWithHook(
  captions: { text: string; startS: number; endS: number }[],
  hook: string,
): { text: string; startS: number; endS: number }[] {
  const first = captions[0];
  const end = Math.min(2, first ? first.endS : 2);
  return [{ text: hook, startS: 0, endS: end }, ...captions];
}
