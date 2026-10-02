import { isLive } from "@/lib/providers/live";
import { createAnthropicModel } from "./anthropic";
import { createKeylessModel } from "./keyless";
import type { AgentModel } from "./types";

export type { AgentModel } from "./types";

/**
 * Claude when `PROVIDER_MODE=live` and `ANTHROPIC_API_KEY` is set (model from
 * `CHAT_AGENT_MODEL`), otherwise the keyless matcher. Tests never go live.
 */
export function resolveAgentModel(): AgentModel {
  if (isLive(["ANTHROPIC_API_KEY"])) {
    return createAnthropicModel({
      apiKey: process.env.ANTHROPIC_API_KEY?.trim() ?? "",
      model: process.env.CHAT_AGENT_MODEL,
    });
  }
  return createKeylessModel();
}
