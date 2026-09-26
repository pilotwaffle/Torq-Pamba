const LEADING_FOR = /^(?:made for|built for|for)\s+/i;
const SMALL_WORDS = new Set(["a", "an", "the", "and", "or", "for", "of", "to", "in", "on", "with", "at", "by", "from"]);

export function normalizePhrase(value: string): string {
  let text = value.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(LEADING_FOR, "").trim();
    if (next === text) break;
    text = next;
  }
  text = text.replace(/[.…,;:!?]+$/g, "").replace(/\.{2,}/g, "").trim();
  text = text.replace(/\s{2,}/g, " ").trim();
  if (!text) return "";
  if (isShout(text)) return capitalize(text.toLowerCase());
  return capitalize(text);
}

function isShout(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Pull "about X" out of a make/create request, drop "our", and normalize casing. */
export function cleanTopic(value: string): string {
  let text = value.replace(/\s+/g, " ").trim();
  const request = text.match(/\b(?:make|create)\b[\s\S]*?\babout\s+(.+)$/i);
  if (request?.[1]) text = request[1].trim();
  text = text.replace(/\bour\b/gi, " ");
  text = text.replace(/^(?:the|a|an)\s+/i, "");
  text = text.replace(/[.!?]+$/g, "");
  return normalizePhrase(text.replace(/\s+/g, " ").trim());
}

export function toTitleCase(value: string): string {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower
        .split("-")
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join("-");
    })
    .join(" ");
}

function limit(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const room = clean.slice(0, max);
  const space = room.lastIndexOf(" ");
  const cut = space >= Math.floor(max * 0.55) ? room.slice(0, space) : room;
  return cut.replace(/[\s,.:;—\-]+$/g, "");
}

export function buildHooks(input: { product: string; audience: string; company: string }): [string, string, string] {
  const product = input.product.trim() || "this";
  const audience = input.audience.trim().toLowerCase() || "you";
  const company = input.company.trim() || "Us";
  const first = limit(`Stop scrolling — ${product}.`) || "Watch this.";
  const second = limit(`Made for ${audience}.`) || "Made for you.";
  let third = limit(`${company}: try it today.`);
  if (!third || third === first || third === second) third = limit("Try it today.") || "Try it today.";
  return [first, second, third];
}

export function ugcScenes(input: {
  avatarName: string;
  product: string;
  company: string;
}): { visuals: [string, string, string]; lines: [string, string, string] } {
  const name = input.avatarName.trim() || "The host";
  const product = input.product.trim() || "this";
  const company = input.company.trim() === "This brand" ? "this brand" : input.company.trim() || "this brand";
  return {
    visuals: [
      `${name} looks straight into the camera in a bright kitchen, holding ${product}, mid-sentence.`,
      `Hands demo ${product} in use on a city sidewalk, ${name} just at the edge of frame.`,
      `${name} at a desk, ${product} in hand, with a clear nod to try it.`,
    ],
    lines: [
      `Hey — real talk. ${product} is the easiest win in my day.`,
      `Watch: I use ${product} just like this. Open, go, done.`,
      `Try ${product} from ${company}. You'll know fast.`,
    ],
  };
}
