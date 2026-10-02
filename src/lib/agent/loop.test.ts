import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { chatMessages, chatToolCalls, conversations, videos } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import { buildHistory, type ChatMessageRow, type ToolCallRow } from "@/lib/agent/conversation";
import type { AgentEvent } from "@/lib/agent/events";
import { resolveToolCall, systemPrompt, toolDefinitions } from "@/lib/agent/loop";
import type { AgentModel, AssistantBlock, ModelMessage, ModelStep, ModelStepInput } from "@/lib/agent/model/types";
import { isPlanMessage } from "@/lib/agent/plan";
import { handleUserMessage } from "@/lib/agent/run";

const password = "correct-horse-battery";

async function account(label: string) {
  return signupAccount({
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password,
    workspaceName: `${label} Co`,
  });
}

type Script = (input: ModelStepInput, index: number) => AssistantBlock[] | ModelStep;

/** A model that plays back scripted steps and records the history it was given. */
function scripted(steps: Script[]) {
  const seen: ModelMessage[][] = [];
  const model: AgentModel = {
    id: "claude-test",
    label: "Test model",
    live: true,
    async step(input) {
      const index = seen.length;
      seen.push(structuredClone(input.messages));
      const script = steps[index];
      if (!script) throw new Error(`No scripted step ${index}`);
      const out = script(input, index);
      if (!Array.isArray(out)) return out;
      for (const block of out) if (block.type === "text") input.onText(String(block.text));
      const toolUse = out.some((block) => block.type === "tool_use");
      return { content: out, stopReason: toolUse ? "tool_use" : "end_turn", inputTokens: 10 + index, outputTokens: 5 };
    },
  };
  return { model, seen };
}

const use = (id: string, name: string, input: Record<string, unknown> = {}): AssistantBlock => ({ type: "tool_use", id, name, input });
const say = (text: string): AssistantBlock => ({ type: "text", text });

const SCRIPT = {
  title: "Cold Brew Commute",
  topic: "oat-milk cold brew",
  durationS: 30,
  scenes: [
    { visual: "Creator on a train holding the can.", line: "My commute coffee just got an upgrade." },
    { visual: "Close-up pour over ice.", line: "Oat-milk cold brew, smooth and ready to go." },
    { visual: "Creator smiles at the camera.", line: "Grab one before your next train." },
  ],
  hooks: ["Commute coffee, fixed", "Cold brew in 5 seconds", "Your train needs this"],
};

function results(messages: ModelMessage[] | undefined) {
  return (messages ?? []).flatMap((message) =>
    message.role === "user" ? message.content.filter((block) => block.type === "tool_result") : [],
  );
}

describe("agent loop", () => {
  it("runs tools over several steps, feeds results back, streams text, and persists everything", async () => {
    const { user, workspace } = await account("loop");
    const { model, seen } = scripted([
      () => [say("Let me check your brand."), use("toolu_a", "brand-brief")],
      () => [use("toolu_b", "write-script", SCRIPT)],
      () => [say("Your script is ready. Want me to estimate the cost?")],
    ]);
    const events: AgentEvent[] = [];
    const turn = await handleUserMessage({
      workspace,
      userId: user.id,
      text: "Write me a script about our cold brew",
      model,
      emit: (event) => events.push(event),
    });
    expect(turn?.paused).toBe(false);
    expect(seen).toHaveLength(3);

    // Step 2 sees step 1's call answered by a tool_result with the brief.
    const second = seen[1] ?? [];
    expect(second[0]?.role).toBe("user");
    expect(second[0]?.content[0]).toEqual({ type: "text", text: "Write me a script about our cold brew" });
    expect(second.at(-2)).toMatchObject({ role: "assistant", content: [say("Let me check your brand."), use("toolu_a", "brand-brief")] });
    expect(results(second)).toEqual([expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_a" })]);
    expect(String(results(second)[0]?.content)).toMatch(/Budget left this month/);
    expect(results(seen[2])).toHaveLength(2);

    const db = await getDb();
    const calls = await db.select().from(chatToolCalls).where(eq(chatToolCalls.workspaceId, workspace.id));
    expect(calls.map((call) => [call.toolName, call.status, call.callId])).toEqual(
      expect.arrayContaining([
        ["brand-brief", "succeeded", "toolu_a"],
        ["write-script", "succeeded", "toolu_b"],
      ]),
    );
    const [thread] = await db.select().from(conversations).where(eq(conversations.id, turn?.conversationId ?? ""));
    expect(thread?.model).toBe("claude-test");
    expect(thread?.title).toBe("Write me a script about our cold brew");

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, thread?.id ?? ""))
      .orderBy(asc(chatMessages.createdAt));
    expect(rows.every((row) => row.conversationId === thread?.id)).toBe(true);
    const plan = rows.find((row) => isPlanMessage(row.data));
    expect(plan && isPlanMessage(plan.data) ? plan.data.plan.title : null).toBe("Cold Brew Commute");
    const steps = rows.filter((row) => row.model === "claude-test");
    expect(steps).toHaveLength(3);
    expect(steps[0]?.inputTokens).toBe(10);
    expect(steps[0]?.outputTokens).toBe(5);

    expect(events[0]).toMatchObject({ type: "turn", conversationId: thread?.id, model: "claude-test" });
    expect(events.filter((event) => event.type === "text").map((event) => (event.type === "text" ? event.delta : ""))).toEqual([
      "Let me check your brand.",
      "Your script is ready. Want me to estimate the cost?",
    ]);
    expect(events.filter((event) => event.type === "tool_call")).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: "done", paused: false });
  });

  it("waits for confirmation before generating, then charges once and continues", async () => {
    const { user, workspace } = await account("confirm");
    const { model, seen } = scripted([
      () => [use("toolu_s", "write-script", SCRIPT)],
      () => [say("Want me to generate it?")],
      () => [say("Starting it once you confirm the card."), use("toolu_g", "start-generation", {})],
      () => [say("Your video is ready to review.")],
    ]);
    await handleUserMessage({ workspace, userId: user.id, text: "Write a script", model });
    const events: AgentEvent[] = [];
    const turn = await handleUserMessage({ workspace, userId: user.id, text: "Generate it", model, emit: (event) => events.push(event) });
    expect(turn?.paused).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", paused: true });
    const waiting = events.find((event) => event.type === "tool_status" && event.status === "awaiting_confirmation");
    expect(waiting && waiting.type === "tool_status" ? waiting.confirmation?.costUsd : null).toBe(3.32);

    const db = await getDb();
    expect(await db.select().from(videos).where(eq(videos.workspaceId, workspace.id))).toHaveLength(0);
    const [call] = await db.select().from(chatToolCalls).where(and(eq(chatToolCalls.workspaceId, workspace.id), eq(chatToolCalls.callId, "toolu_g")));
    expect(call?.status).toBe("awaiting_confirmation");
    expect(call?.arguments.planMessageId).toEqual(expect.any(String));
    expect(seen).toHaveLength(3);

    const resumed: AgentEvent[] = [];
    const confirm = { workspace, userId: user.id, toolCallId: call?.id ?? "", decision: "confirm" as const, model, emit: (event: AgentEvent) => resumed.push(event) };
    expect(await resolveToolCall(confirm)).toMatchObject({ ok: true });
    expect(await resolveToolCall(confirm)).toEqual({ ok: false, error: "That step is no longer waiting for you." });

    const made = await db.select().from(videos).where(eq(videos.workspaceId, workspace.id));
    expect(made).toHaveLength(1);
    const [done] = await db.select().from(chatToolCalls).where(eq(chatToolCalls.id, call?.id ?? ""));
    expect(done?.status).toBe("succeeded");
    expect(done?.confirmedBy).toBe(user.id);
    expect(Number(done?.costUsd)).toBeGreaterThan(0);
    expect(seen).toHaveLength(4);
    const last = results(seen[3]).at(-1);
    expect(last).toMatchObject({ tool_use_id: "toolu_g" });
    expect(last?.is_error).toBeUndefined();
    expect(resumed.map((event) => event.type)).toContain("text");
  });

  it("tells the model when the user declines, or answers with a new message instead", async () => {
    const { user, workspace } = await account("decline");
    const { model, seen } = scripted([
      () => [use("toolu_s", "write-script", SCRIPT)],
      () => [say("Saved.")],
      () => [use("toolu_g1", "start-generation", {})],
      () => [say("Okay, I won't generate it.")],
      () => [use("toolu_g2", "start-generation", {})],
      () => [say("Sure, let's change the hook first.")],
    ]);
    await handleUserMessage({ workspace, userId: user.id, text: "Write a script", model });
    await handleUserMessage({ workspace, userId: user.id, text: "Generate", model });
    const db = await getDb();
    const [first] = await db.select().from(chatToolCalls).where(and(eq(chatToolCalls.workspaceId, workspace.id), eq(chatToolCalls.callId, "toolu_g1")));
    await resolveToolCall({ workspace, userId: user.id, toolCallId: first?.id ?? "", decision: "reject", model, emit: () => {} });
    expect(results(seen[3]).at(-1)).toMatchObject({ tool_use_id: "toolu_g1", is_error: true });

    await handleUserMessage({ workspace, userId: user.id, text: "Generate", model });
    await handleUserMessage({ workspace, userId: user.id, text: "Actually, change the hook first", model });
    const [second] = await db.select().from(chatToolCalls).where(and(eq(chatToolCalls.workspaceId, workspace.id), eq(chatToolCalls.callId, "toolu_g2")));
    expect(second?.status).toBe("rejected");
    expect(results(seen[5]).at(-1)).toMatchObject({ tool_use_id: "toolu_g2", is_error: true });
    expect(await db.select().from(videos).where(eq(videos.workspaceId, workspace.id))).toHaveLength(0);
  });

  it("needs every acknowledgement ticked before approving", async () => {
    const { user, workspace } = await account("approve");
    const db = await getDb();
    const [video] = await db
      .insert(videos)
      .values({ workspaceId: workspace.id, title: "Ready clip", status: "ready", aiGenerated: true })
      .returning();
    const { model } = scripted([
      () => [use("toolu_ap", "approve-video", { privacy: "only_me" })],
      () => [say("Approved.")],
    ]);
    await handleUserMessage({ workspace, userId: user.id, text: "Approve it, only me", model });
    const [call] = await db.select().from(chatToolCalls).where(and(eq(chatToolCalls.workspaceId, workspace.id), eq(chatToolCalls.callId, "toolu_ap")));
    expect(call?.arguments.videoId).toBe(video?.id);
    const base = { workspace, userId: user.id, toolCallId: call?.id ?? "", decision: "confirm" as const, model, emit: () => {} };
    expect(await resolveToolCall({ ...base, acknowledged: ["I consent to schedule this video"] })).toEqual({
      ok: false,
      error: "Tick each box before you confirm.",
    });
    const acknowledged = ["I agree to TikTok's Music Usage Confirmation", "I consent to schedule this video"];
    expect(await resolveToolCall({ ...base, acknowledged })).toMatchObject({ ok: true });
    const [after] = await db.select().from(videos).where(eq(videos.id, video?.id ?? ""));
    expect(after?.status).toBe("approved");
    expect(after?.aiGenerated).toBe(true);
  });

  it("returns errors for unknown tools and bad arguments, and never runs tools from a refusal", async () => {
    const { user, workspace } = await account("errors");
    const { model, seen } = scripted([
      () => [use("toolu_x", "post-to-tiktok", {}), use("toolu_y", "estimate-cost", { durationS: 900 })],
      () => ({ content: [say("I can't"), use("toolu_z", "list-videos", {})], stopReason: "refusal", inputTokens: 1, outputTokens: 1 }),
    ]);
    await handleUserMessage({ workspace, userId: user.id, text: "Post it everywhere", model });
    const [unknown, invalid] = results(seen[1]);
    expect(unknown).toMatchObject({ tool_use_id: "toolu_x", is_error: true });
    expect(String(unknown?.content)).toMatch(/Unknown tool post-to-tiktok/);
    expect(invalid).toMatchObject({ tool_use_id: "toolu_y", is_error: true });
    expect(String(invalid?.content)).toMatch(/Invalid arguments/);

    const db = await getDb();
    expect(await db.select().from(chatToolCalls).where(eq(chatToolCalls.callId, "toolu_z"))).toHaveLength(0);
    const [stored] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.workspaceId, workspace.id))
      .orderBy(chatMessages.createdAt)
      .then((rows) => rows.slice(-1));
    expect(stored?.content).toMatch(/I can’t help with that one/);
  });

  it("reports an unavailable model in the chat instead of failing the turn", async () => {
    const { user, workspace } = await account("down");
    const model: AgentModel = { id: "claude-test", label: "Test", live: true, step: async () => Promise.reject(new Error("HTTP 529")) };
    const events: AgentEvent[] = [];
    await handleUserMessage({ workspace, userId: user.id, text: "hi", model, emit: (event) => events.push(event) });
    expect(events).toContainEqual({ type: "error", message: expect.stringMatching(/unavailable right now \(HTTP 529\)/) });
  });
});

describe("tool definitions and prompt", () => {
  it("gives every tool an object schema, with defaulted fields optional", () => {
    const tools = toolDefinitions();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["brand-brief", "write-script", "revise-script", "pick-avatar", "estimate-cost", "start-generation", "list-videos", "approve-video", "schedule", "plan"]),
    );
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema).not.toHaveProperty("$schema");
    }
    const write = tools.find((tool) => tool.name === "write-script");
    expect(write?.input_schema.required).toEqual(expect.arrayContaining(["title", "scenes", "hooks"]));
    expect(write?.input_schema.required).not.toContain("durationS");
  });

  it("keeps the system prompt identical over time", async () => {
    const { workspace } = await account("prompt");
    expect(systemPrompt(workspace)).toBe(systemPrompt(workspace));
    expect(systemPrompt(workspace)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("buildHistory", () => {
  let clock = Date.parse("2026-10-01T10:00:00Z");
  function row(role: "user" | "assistant", content: string, data: Record<string, unknown> | null = null): ChatMessageRow {
    clock += 1000;
    return { id: crypto.randomUUID(), role, content, data, createdAt: new Date(clock) } as ChatMessageRow;
  }
  const thinking = (signature: string): AssistantBlock => ({ type: "thinking", thinking: "", signature });
  const step = (blocks: AssistantBlock[]) => row("assistant", "", { kind: "agent-step", blocks });
  const done = (callId: string) => ({ callId, status: "succeeded", result: { replies: [{ text: "ok" }] } }) as unknown as ToolCallRow;

  it("adds the send time, keeps thinking only for the current turn, and drops tool replies", () => {
    const rows = [
      row("user", "first"),
      step([thinking("old"), use("t1", "list-videos")]),
      row("assistant", "No videos yet.", { kind: "videos", toolCallId: "c1" }),
      step([thinking("old2"), say("None yet.")]),
      row("user", "second"),
      step([thinking("new"), use("t2", "list-videos")]),
    ];
    const history = buildHistory(rows, [done("t1"), done("t2")], "America/New_York");
    expect(history.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
    expect(history[0]?.content[1]).toEqual({ type: "text", text: "[App] Sent Thursday, October 1, 2026 at 6:00 AM (America/New_York)." });
    expect(history[1]?.content).toEqual([use("t1", "list-videos")]);
    expect(history[3]?.content).toEqual([say("None yet.")]);
    expect(history[5]?.content).toEqual([thinking("new"), use("t2", "list-videos")]);
    expect(JSON.stringify(history)).not.toContain("No videos yet.\"}");
  });

  it("trims whole turns and never leaves an orphan tool result", () => {
    const rows = [];
    for (let turn = 0; turn < 14; turn += 1) {
      rows.push(row("user", `turn ${turn}`), step([use(`t${turn}`, "list-videos")]));
    }
    const history = buildHistory(rows, rows.map((_, index) => done(`t${index}`)));
    const first = history[0];
    expect(first?.role).toBe("user");
    expect(first?.content.map((block) => block.type)).toEqual(["text", "text"]);
    expect(first?.content[0]).toEqual({ type: "text", text: "turn 2" });
    const prefix = JSON.stringify(history);
    rows.push(step([say("more")]));
    expect(JSON.stringify(buildHistory(rows, rows.map((_, index) => done(`t${index}`)))).startsWith(prefix.slice(0, -1))).toBe(true);
  });
});
