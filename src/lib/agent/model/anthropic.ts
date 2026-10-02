import { ProviderUnavailableError } from "@/lib/providers/types";
import type { AgentModel, AssistantBlock, ModelMessage, ModelStep, ModelStepInput, ToolDefinition } from "./types";

/** Current Claude Opus per https://platform.claude.com/docs/en/about-claude/models/overview — read 2026-10-01. */
export const DEFAULT_AGENT_MODEL = "claude-opus-5-5";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
/** Server-side refusal fallback: the API retries a declined request on the model Anthropic picks for that category. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const MAX_TOKENS = 64_000;
const STEP_TIMEOUT_MS = 300_000;

const LABELS: Record<string, string> = {
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-fable-5-1": "Claude Fable 5.1",
  "claude-opus-5": "Claude Opus 5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
};

export function anthropicModelLabel(model: string): string {
  return LABELS[model] ?? model;
}

export function usesFallback(model: string): boolean {
  return FALLBACK_MODELS.has(model);
}

/** Streaming Messages API body with client tools. https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use */
export function buildAgentRequest(
  model: string,
  input: { system: string; messages: ModelMessage[]; tools: ToolDefinition[] },
  maxTokens = MAX_TOKENS,
) {
  return {
    model,
    max_tokens: maxTokens,
    stream: true,
    system: input.system,
    messages: input.messages,
    ...(input.tools.length > 0 ? { tools: input.tools, tool_choice: { type: "auto" } } : {}),
    ...(usesFallback(model) ? { fallbacks: "default" } : {}),
  };
}

type StreamEvent = {
  type?: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: Record<string, unknown> & { type?: string };
  delta?: Record<string, unknown> & { type?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
};

/** Splits a server-sent-event body into parsed `data:` payloads. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (chunk: string): StreamEvent | null => {
    const data = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return null;
    try {
      return JSON.parse(data) as StreamEvent;
    } catch {
      return null;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let found = /\r?\n\r?\n/.exec(buffer); found; found = /\r?\n\r?\n/.exec(buffer)) {
      const event = parse(buffer.slice(0, found.index));
      buffer = buffer.slice(found.index + found[0].length);
      if (event) yield event;
    }
  }
  buffer += decoder.decode();
  const last = parse(buffer);
  if (last) yield last;
}

/**
 * Folds stream events into the final content blocks. Tool input arrives as
 * partial JSON and is parsed at `content_block_stop`; thinking blocks keep their
 * signature so they can be sent back unmodified.
 */
export async function accumulateStream(
  modelId: string,
  events: AsyncIterable<StreamEvent>,
  onText: (delta: string) => void,
): Promise<ModelStep> {
  const blocks: Record<string, unknown>[] = [];
  const partialJson = new Map<number, string>();
  let stopReason = "end_turn";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  for await (const event of events) {
    const index = event.index ?? 0;
    switch (event.type) {
      case "message_start":
        inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
        outputTokens = event.message?.usage?.output_tokens ?? outputTokens;
        break;
      case "content_block_start": {
        const block = { ...(event.content_block ?? { type: "text", text: "" }) };
        if (block.type === "tool_use") {
          block.input = {};
          partialJson.set(index, "");
        }
        blocks[index] = block;
        break;
      }
      case "content_block_delta": {
        const block = blocks[index];
        const delta = event.delta ?? {};
        if (!block) break;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          block.text = `${typeof block.text === "string" ? block.text : ""}${delta.text}`;
          onText(delta.text);
        } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          partialJson.set(index, `${partialJson.get(index) ?? ""}${delta.partial_json}`);
        } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
          block.thinking = `${typeof block.thinking === "string" ? block.thinking : ""}${delta.thinking}`;
        } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
          block.signature = delta.signature;
        } else if (delta.type === "citations_delta" && delta.citation) {
          block.citations = [...(Array.isArray(block.citations) ? block.citations : []), delta.citation];
        }
        break;
      }
      case "content_block_stop": {
        const block = blocks[index];
        if (block?.type === "tool_use") block.input = parseToolInput(partialJson.get(index) ?? "");
        break;
      }
      case "message_delta":
        if (typeof event.delta?.stop_reason === "string") stopReason = event.delta.stop_reason;
        outputTokens = event.usage?.output_tokens ?? outputTokens;
        inputTokens = event.usage?.input_tokens ?? inputTokens;
        break;
      case "error":
        throw new ProviderUnavailableError(modelId, event.error?.message ?? event.error?.type ?? "stream error");
      default:
        break;
    }
  }
  return {
    content: afterFallback(blocks.filter(Boolean) as AssistantBlock[]),
    stopReason,
    inputTokens,
    outputTokens,
  };
}

/**
 * After a mid-output fallback, blocks from the declined model before the last
 * `fallback` marker are not echoed back except text; the marker itself is dropped.
 */
export function afterFallback(blocks: AssistantBlock[]): AssistantBlock[] {
  const boundary = blocks.findLastIndex((block) => block.type === "fallback");
  if (boundary < 0) return blocks;
  return [...blocks.slice(0, boundary).filter((block) => block.type === "text"), ...blocks.slice(boundary + 1)];
}

function parseToolInput(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createAnthropicModel(options: {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  fetch?: typeof fetch;
}): AgentModel {
  const model = options.model?.trim() || DEFAULT_AGENT_MODEL;
  const doFetch = options.fetch ?? fetch;
  return {
    id: model,
    label: anthropicModelLabel(model),
    live: true,
    async step(input: ModelStepInput): Promise<ModelStep> {
      const timeout = AbortSignal.timeout(STEP_TIMEOUT_MS);
      let response: Response;
      try {
        response = await doFetch(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
            "x-api-key": options.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            ...(usesFallback(model) ? { "anthropic-beta": FALLBACK_BETA } : {}),
          },
          body: JSON.stringify(buildAgentRequest(model, input, options.maxTokens)),
          signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
        });
      } catch (error) {
        throw new ProviderUnavailableError(model, error instanceof Error ? error.message : "network");
      }
      if (!response.ok || !response.body) {
        const text = (await response.text().catch(() => "")).slice(0, 300);
        const hint = response.status === 401 || response.status === 403 ? "check ANTHROPIC_API_KEY. " : "";
        throw new ProviderUnavailableError(model, `HTTP ${response.status}: ${hint}${text}`);
      }
      return accumulateStream(model, readSse(response.body), input.onText);
    },
  };
}
