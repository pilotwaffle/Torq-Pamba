import { describe, expect, it, vi } from "vitest";
import { createKeylessModel } from "./keyless";
import { resolveAgentModel } from "./index";
import {
  accumulateStream,
  afterFallback,
  buildAgentRequest,
  createAnthropicModel,
  DEFAULT_AGENT_MODEL,
  FALLBACK_BETA,
  readSse,
} from "./anthropic";

function sse(events: Record<string, unknown>[], chunkSize = 17): ReadableStream<Uint8Array> {
  const text = events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < bytes.length; at += chunkSize) controller.enqueue(bytes.slice(at, at + chunkSize));
      controller.close();
    },
  });
}

const TOOL_TURN = [
  { type: "message_start", message: { usage: { input_tokens: 120, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Checking your " } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "brand." } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "estimate-cost", input: {} } },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"durationS"' } },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: ": 20}" } },
  { type: "content_block_stop", index: 2 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } },
  { type: "message_stop" },
];

describe("Anthropic client", () => {
  it("folds a streamed tool-use turn into blocks, keeping the thinking signature", async () => {
    const deltas: string[] = [];
    const step = await accumulateStream("m", readSse(sse(TOOL_TURN)), (delta) => deltas.push(delta));
    expect(deltas.join("")).toBe("Checking your brand.");
    expect(step.stopReason).toBe("tool_use");
    expect(step.inputTokens).toBe(120);
    expect(step.outputTokens).toBe(42);
    expect(step.content).toEqual([
      { type: "thinking", thinking: "", signature: "sig-1" },
      { type: "text", text: "Checking your brand." },
      { type: "tool_use", id: "toolu_1", name: "estimate-cost", input: { durationS: 20 } },
    ]);
  });

  it("raises a stream error event", async () => {
    const events = [{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }];
    await expect(accumulateStream("m", readSse(sse(events)), () => {})).rejects.toThrow(/Overloaded/);
  });

  it("builds a streaming request with tools and the refusal fallback", () => {
    const tools = [{ name: "brand-brief", description: "d", input_schema: { type: "object", properties: {} } }];
    const body = buildAgentRequest(DEFAULT_AGENT_MODEL, { system: "s", messages: [], tools });
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      stream: true,
      system: "s",
      tools,
      tool_choice: { type: "auto" },
      fallbacks: "default",
    });
    expect(buildAgentRequest("claude-haiku-4-5", { system: "s", messages: [], tools: [] })).not.toHaveProperty("fallbacks");
  });

  it("drops the declined model's non-text blocks before a fallback marker", () => {
    expect(
      afterFallback([
        { type: "thinking", thinking: "", signature: "a" },
        { type: "text", text: "Partial" },
        { type: "tool_use", id: "t0", name: "x", input: {} },
        { type: "fallback", from: { model: "a" }, to: { model: "b" } },
        { type: "text", text: " rest" },
      ]),
    ).toEqual([
      { type: "text", text: "Partial" },
      { type: "text", text: " rest" },
    ]);
  });

  it("posts with the key, version, and beta headers, and reports HTTP errors without the key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(sse(TOOL_TURN), { status: 200 }));
    const model = createAnthropicModel({ apiKey: "sk-test", fetch: fetchMock });
    expect(model.id).toBe(DEFAULT_AGENT_MODEL);
    expect(model.label).toBe("Claude Opus 5.5");
    const step = await model.step({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], tools: [], onText: () => {} });
    expect(step.stopReason).toBe("tool_use");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-beta"]).toBe(FALLBACK_BETA);

    const denied = createAnthropicModel({
      apiKey: "sk-secret-value",
      model: "claude-sonnet-5-5",
      fetch: async () => new Response('{"error":{"type":"authentication_error"}}', { status: 401 }),
    });
    const error = await denied.step({ system: "s", messages: [], tools: [], onText: () => {} }).catch((caught: unknown) => caught);
    expect(String(error)).toMatch(/401: check ANTHROPIC_API_KEY/);
    expect(String(error)).not.toContain("sk-secret-value");
  });

  it("falls back to the keyless model without a live key", () => {
    expect(resolveAgentModel().id).toBe("keyless");
    expect(createKeylessModel().live).toBe(false);
  });
});
