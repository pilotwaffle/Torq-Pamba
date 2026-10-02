/**
 * Messages in the Anthropic Messages API shape, which the agent uses as its own
 * format. Another vendor's client translates to and from these blocks.
 */
export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
/** Thinking, redacted thinking, and any block type added later. Sent back unmodified. */
export type OtherBlock = { type: string; [key: string]: unknown };

export type AssistantBlock = TextBlock | ToolUseBlock | OtherBlock;
export type UserBlock = TextBlock | ToolResultBlock;

export type ModelMessage =
  | { role: "user"; content: UserBlock[] }
  | { role: "assistant"; content: AssistantBlock[] };

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ModelStepInput = {
  system: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  /** Called with each piece of streamed text. */
  onText(delta: string): void;
  signal?: AbortSignal;
};

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn" | "refusal" | string;

export type ModelStep = {
  content: AssistantBlock[];
  stopReason: StopReason;
  inputTokens: number | null;
  outputTokens: number | null;
};

/**
 * Prefix of the user-side text that carries app events (a Generate click, an older
 * reply) into the history, so the model never sees them as its own words.
 */
export const APP_NOTE_PREFIX = "[App]";

export type AgentModel = {
  /** Vendor model id, or `keyless`. Stored on messages and conversations. */
  id: string;
  label: string;
  live: boolean;
  step(input: ModelStepInput): Promise<ModelStep>;
};

export function isToolUse(block: AssistantBlock): block is ToolUseBlock {
  return block.type === "tool_use" && typeof (block as ToolUseBlock).id === "string";
}

export function isText(block: AssistantBlock | UserBlock): block is TextBlock {
  return block.type === "text" && typeof (block as TextBlock).text === "string";
}
