export type Intent =
  | { type: "plan"; count: number; durationS: number; topic: string }
  | { type: "schedule"; when: "tomorrow-9am" | "next-good-slot" }
  | { type: "list-schedule" }
  | { type: "unknown" };

const DURATION = String.raw`(\d+)\s*(?:s|sec|secs|seconds?)\b`;

export function parseIntent(text: string): Intent {
  const cleaned = text.trim().replace(/[!?.]+$/g, "").trim();
  if (/what(?:'s|’s| is) scheduled/i.test(cleaned)) return { type: "list-schedule" };
  if (/\bnext good slot\b/i.test(cleaned)) return { type: "schedule", when: "next-good-slot" };
  if (/\btomorrow at 9(?::00)?\s*am\b/i.test(cleaned) || /\bschedule it tomorrow\b/i.test(cleaned)) {
    return { type: "schedule", when: "tomorrow-9am" };
  }
  return parseMake(cleaned) ?? { type: "unknown" };
}

function parseMake(text: string): Intent | null {
  const match = text.match(/^(?:please\s+)?(?:make|create)\s+(.+)$/i);
  if (!match?.[1]) return null;
  const rest = match[1].trim();
  const about = rest.match(/\bvideos?\b(?:\s+about\s+(.+))?$/i);
  if (!about || about.index == null) return null;
  const topic = (about[1] ?? "").trim();
  if (!topic) return null;
  const head = rest.slice(0, about.index).trim().replace(/^(?:a|an)\s+/i, "");
  let count = 1;
  let durationS = 30;
  const pair = head.match(new RegExp(`^(\\d+)\\s+${DURATION}$`, "i"));
  const onlyDuration = head.match(new RegExp(`^${DURATION}$`, "i"));
  const onlyCount = head.match(/^(\d+)$/);
  if (pair) {
    count = Number(pair[1]);
    durationS = Number(pair[2]);
  } else if (onlyDuration) {
    durationS = Number(onlyDuration[1]);
  } else if (onlyCount) {
    count = Number(onlyCount[1]);
  } else if (head) {
    return null;
  }
  if (!Number.isFinite(count) || !Number.isFinite(durationS)) return null;
  return {
    type: "plan",
    count: Math.min(10, Math.max(1, Math.round(count))),
    durationS: Math.min(60, Math.max(1, Math.round(durationS))),
    topic,
  };
}
