import type { ToolConfirmation } from "@/lib/agent/tools/types";

export type ToolCallStatus = "pending" | "awaiting_confirmation" | "running" | "succeeded" | "failed" | "rejected";

/** One line of the NDJSON stream from `/api/chat` and `/api/chat/confirm`. Safe to import in client components. */
export type AgentEvent =
  | { type: "turn"; conversationId: string; model: string }
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | {
      type: "tool_status";
      id: string;
      name: string;
      status: ToolCallStatus;
      summary?: string;
      error?: string;
      confirmation?: ToolConfirmation;
    }
  | { type: "error"; message: string }
  | { type: "done"; paused: boolean };

export type EmitAgentEvent = (event: AgentEvent) => void;

/** `data.kind` of the assistant message that holds one model step and its tool calls. */
export const AGENT_STEP = "agent-step";

export function isAgentStep(data: unknown): data is { kind: typeof AGENT_STEP; blocks?: unknown } {
  return Boolean(data && typeof data === "object" && (data as { kind?: unknown }).kind === AGENT_STEP);
}

/** Messages a tool posted through `ctx.reply` carry the id of their call. */
export function toolCallIdOf(data: unknown): string | null {
  const id = data && typeof data === "object" ? (data as { toolCallId?: unknown }).toolCallId : null;
  return typeof id === "string" ? id : null;
}
