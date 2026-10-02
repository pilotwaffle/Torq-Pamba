/**
 * De-slop rewriter: removes the stock phrases that make AI-written captions and
 * scripts read as generated. Deterministic rules, each with a reason, so the
 * writer sees what changed and can undo it.
 */

export type SlopRule = { pattern: RegExp; replace: string; reason: string };
export type SlopChange = { from: string; to: string; reason: string };

export const SLOP_RULES: SlopRule[] = [
  { pattern: /\bin today'?s (fast-paced|digital|modern) world,?\s*/gi, replace: "", reason: "Throat-clearing opener" },
  { pattern: /\b(in conclusion|to sum up|at the end of the day),?\s*/gi, replace: "", reason: "Filler wrap-up" },
  { pattern: /\b(moreover|furthermore|additionally),\s*/gi, replace: "Also, ", reason: "Essay connector" },
  { pattern: /\bdelve(s|d)? into\b/gi, replace: "dig into", reason: "Stock AI verb" },
  { pattern: /\bdelving into\b/gi, replace: "digging into", reason: "Stock AI verb" },
  { pattern: /\bunlock(s|ed)? (the|your) (full )?potential( of)?\b/gi, replace: "get more from", reason: "Empty promise" },
  { pattern: /\belevate(s|d)? your\b/gi, replace: "improve your", reason: "Stock AI verb" },
  { pattern: /\bgame[- ]chang(er|ing)\b/gi, replace: "big deal", reason: "Hype cliché" },
  { pattern: /\brevolutioniz(e|es|ed|ing)\b/gi, replace: "chang$1", reason: "Hype cliché" },
  { pattern: /\bcutting[- ]edge\b/gi, replace: "new", reason: "Hype cliché" },
  { pattern: /\bseamless(ly)?\b/gi, replace: "smooth$1", reason: "Stock AI adjective" },
  { pattern: /\bleverag(e|es|ed|ing)\b/gi, replace: "us$1", reason: "Corporate verb" },
  { pattern: /\ba testament to\b/gi, replace: "proof of", reason: "Stock AI phrase" },
  { pattern: /\b(rich )?tapestry of\b/gi, replace: "mix of", reason: "Stock AI phrase" },
  { pattern: /\bembark(s|ed)? on\b/gi, replace: "start$1", reason: "Stock AI verb" },
  { pattern: /\bnavigate the (complexities|intricacies) of\b/gi, replace: "deal with", reason: "Stock AI phrase" },
  { pattern: /\bnavigating the (complexities|intricacies) of\b/gi, replace: "dealing with", reason: "Stock AI phrase" },
  { pattern: /\bboasts\b/gi, replace: "has", reason: "Brochure verb" },
  { pattern: /!{2,}/g, replace: "!", reason: "Stacked exclamation marks" },
];

function matchCase(original: string, replacement: string): string {
  if (!replacement) return replacement;
  if (original[0] && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return replacement[0]!.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** "It's not just X, it's Y" -> "It's Y". */
const NOT_JUST = /\b(it'?s|this is) not just [^,.;!?]+[,;] (it'?s|this is) /gi;

export function deslop(input: string): { text: string; changes: SlopChange[] } {
  const changes: SlopChange[] = [];
  let text = input.replace(NOT_JUST, (match, _a: string, b: string) => {
    const to = `${matchCase(match, b)} `;
    changes.push({ from: match.trim(), to: to.trim(), reason: "“Not just X, it's Y” formula" });
    return to;
  });
  for (const rule of SLOP_RULES) {
    text = text.replace(rule.pattern, (match: string, ...groups: unknown[]) => {
      const captures = groups.slice(0, -2) as (string | undefined)[];
      const filled = rule.replace.replace(/\$(\d)/g, (_m, n: string) => captures[Number(n) - 1] ?? "");
      const to = matchCase(match, filled);
      changes.push({ from: match.trim(), to: to.trim(), reason: rule.reason });
      return to;
    });
  }
  const dashes = (text.match(/\s?—\s?/g) ?? []).length;
  if (dashes > 2) {
    text = text.replace(/\s?—\s?/g, ", ");
    changes.push({ from: "—", to: ",", reason: `${dashes} em dashes (a common AI tell)` });
  }
  text = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
    .trim();
  return { text, changes };
}
