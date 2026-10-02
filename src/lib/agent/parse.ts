import { chatTools } from "@/lib/agent/tools/registry";

/** `type` is the matched tool's name, or "unknown"; the rest are its validated arguments. */
export type Intent = { type: string } & Record<string, unknown>;

export function parseIntent(text: string): Intent {
  const found = chatTools.match(text);
  return found ? { type: found.tool.name, ...found.args } : { type: "unknown" };
}
