import { chatTools } from "@/lib/agent/tools/registry";
import { APP_NOTE_PREFIX, isText, type AgentModel, type ModelStep } from "./types";

export const KEYLESS_MODEL_ID = "keyless";

export const KEYLESS_HELP =
  "I can plan a video (“make a 30s video about …”), schedule an approved video, or tell you what’s scheduled.";

/**
 * The no-LLM agent: each tool's `match` reads the newest user text (lowest
 * `priority` first) and becomes one tool call. After the tool results come back
 * it ends the turn, so the tools' own replies are the answer.
 */
export function createKeylessModel(): AgentModel {
  return {
    id: KEYLESS_MODEL_ID,
    label: "Keyless mode",
    live: false,
    async step(input): Promise<ModelStep> {
      const last = input.messages.at(-1);
      const tail =
        last?.role === "user"
          ? last.content.findLast((block) => !(isText(block) && block.text.startsWith(APP_NOTE_PREFIX)))
          : undefined;
      if (!tail || !isText(tail)) return { content: [], stopReason: "end_turn", inputTokens: null, outputTokens: null };

      const found = chatTools.match(tail.text);
      if (!found) {
        input.onText(KEYLESS_HELP);
        return { content: [{ type: "text", text: KEYLESS_HELP }], stopReason: "end_turn", inputTokens: null, outputTokens: null };
      }
      return {
        content: [{ type: "tool_use", id: `toolu_keyless_${crypto.randomUUID().replace(/-/g, "")}`, name: found.tool.name, input: found.args }],
        stopReason: "tool_use",
        inputTokens: null,
        outputTokens: null,
      };
    },
  };
}
