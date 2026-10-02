import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages, chatToolCalls, conversations } from "@/db/schema";
import { isAgentStep, toolCallIdOf } from "@/lib/agent/events";
import {
  APP_NOTE_PREFIX,
  isText,
  isToolUse,
  type AssistantBlock,
  type ModelMessage,
  type ToolResultBlock,
  type UserBlock,
} from "@/lib/agent/model/types";

export type Conversation = typeof conversations.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ToolCallRow = typeof chatToolCalls.$inferSelect;

/** Recent user turns sent to the model. */
const HISTORY_TURNS = 12;
const RESULT_CHARS = 6000;

export async function getConversation(workspaceId: string, conversationId: string): Promise<Conversation | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/** Starts a thread. The first one in a workspace adopts the messages written before threads existed. */
export async function createConversation(workspaceId: string, userId: string): Promise<Conversation> {
  const db = await getDb();
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.workspaceId, workspaceId))
    .limit(1);
  const [created] = await db.insert(conversations).values({ workspaceId, createdBy: userId }).returning();
  if (!created) throw new Error("Could not start a conversation");
  if (!existing) {
    await db
      .update(chatMessages)
      .set({ conversationId: created.id })
      .where(and(eq(chatMessages.workspaceId, workspaceId), isNull(chatMessages.conversationId)));
  }
  return created;
}

/** The most recently active open thread, created on first use. */
export async function currentConversation(workspaceId: string, userId: string): Promise<Conversation> {
  const db = await getDb();
  const [latest] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), isNull(conversations.archivedAt)))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  return latest ?? createConversation(workspaceId, userId);
}

export async function listConversations(workspaceId: string, limit = 12) {
  const db = await getDb();
  return db
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), isNull(conversations.archivedAt)))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
}

export async function touchConversation(conversation: Conversation, input: { model?: string; firstText?: string }) {
  const db = await getDb();
  const title = conversation.title || (input.firstText ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  await db
    .update(conversations)
    .set({ updatedAt: new Date(), title, ...(input.model ? { model: input.model } : {}) })
    .where(eq(conversations.id, conversation.id));
}

export async function listConversationMessages(workspaceId: string, conversationId: string) {
  const db = await getDb();
  return db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.workspaceId, workspaceId), eq(chatMessages.conversationId, conversationId)))
    .orderBy(asc(chatMessages.createdAt));
}

export async function listConversationToolCalls(workspaceId: string, conversationId: string) {
  const db = await getDb();
  return db
    .select()
    .from(chatToolCalls)
    .where(and(eq(chatToolCalls.workspaceId, workspaceId), eq(chatToolCalls.conversationId, conversationId)))
    .orderBy(asc(chatToolCalls.createdAt));
}

/** Calls in a step that still wait for the user. */
export async function awaitingCallsForMessage(messageId: string) {
  const db = await getDb();
  return db
    .select({ id: chatToolCalls.id })
    .from(chatToolCalls)
    .where(and(eq(chatToolCalls.messageId, messageId), inArray(chatToolCalls.status, ["awaiting_confirmation", "running", "pending"])));
}

/** A new user message answers for any confirmation still open in the thread: those calls are declined. */
export async function rejectOpenConfirmations(workspaceId: string, conversationId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .update(chatToolCalls)
    .set({ status: "rejected", error: "The user sent a new message instead of confirming.", completedAt: new Date() })
    .where(
      and(
        eq(chatToolCalls.workspaceId, workspaceId),
        eq(chatToolCalls.conversationId, conversationId),
        eq(chatToolCalls.status, "awaiting_confirmation"),
      ),
    )
    .returning({ id: chatToolCalls.id });
  return rows.length;
}

export function toolResultBlock(call: ToolCallRow | undefined, toolUseId: string): ToolResultBlock {
  if (!call) return { type: "tool_result", tool_use_id: toolUseId, content: "This call was not recorded.", is_error: true };
  if (call.status === "succeeded") {
    return { type: "tool_result", tool_use_id: toolUseId, content: clip(JSON.stringify(call.result ?? {})) };
  }
  if (call.status === "failed") {
    return { type: "tool_result", tool_use_id: toolUseId, content: call.error || "The tool failed.", is_error: true };
  }
  if (call.status === "rejected") {
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `The user did not confirm, so nothing ran. ${call.error ?? ""}`.trim(),
      is_error: true,
    };
  }
  return { type: "tool_result", tool_use_id: toolUseId, content: "Waiting for the user to confirm in the chat." };
}

function clip(text: string): string {
  return text.length <= RESULT_CHARS ? text : `${text.slice(0, RESULT_CHARS)}…(truncated)`;
}

function appNote(row: ChatMessageRow): string {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const refs = [
    typeof data.kind === "string" ? `${data.kind} message ${row.id}` : `message ${row.id}`,
    typeof data.videoId === "string" ? `video ${data.videoId}` : "",
  ].filter(Boolean);
  return `${APP_NOTE_PREFIX} ${row.content} (${refs.join(", ")})`;
}

/** Thinking that belongs to an earlier turn is dropped; the API allows removing thinking from the front of the chain. */
const THINKING = new Set(["thinking", "redacted_thinking"]);

function storedBlocks(row: ChatMessageRow, keepThinking: boolean): AssistantBlock[] {
  const data = row.data as { blocks?: unknown } | null;
  const blocks = Array.isArray(data?.blocks) ? (data.blocks as AssistantBlock[]) : [];
  const usable = blocks.filter((block) => block && typeof block === "object" && typeof block.type === "string");
  if (usable.length === 0 && row.content.trim()) return [{ type: "text", text: row.content }];
  return usable.filter((block) => !(isText(block) && !block.text.trim()) && (keepThinking || !THINKING.has(block.type)));
}

function sentNote(row: ChatMessageRow, timeZone: string): string {
  const local = row.createdAt.toLocaleString("en-US", { timeZone, dateStyle: "full", timeStyle: "short" });
  return `${APP_NOTE_PREFIX} Sent ${local} (${timeZone}).`;
}

/**
 * Rebuilds the model history from the database. Each step is replayed with its
 * blocks and followed by one user message of tool results. Tool replies are
 * summarized inside those results; other assistant rows become app notes on the
 * user side. Consecutive same-role messages are merged.
 *
 * The output only ever grows within a turn, so thinking blocks replayed from the
 * current turn keep a byte-identical prefix: the send time lives on each user
 * message (not in the system prompt), thinking from earlier turns is dropped, and
 * trimming cuts whole turns, which only moves when the user sends a new message.
 */
export function buildHistory(rows: ChatMessageRow[], calls: ToolCallRow[], timeZone = "UTC"): ModelMessage[] {
  const byCallId = new Map(calls.filter((call) => call.callId).map((call) => [call.callId as string, call]));
  const out: ModelMessage[] = [];
  const turnStarts: number[] = [];
  const push = (message: ModelMessage) => {
    const last = out.at(-1);
    if (last && last.role === message.role) {
      (last.content as (AssistantBlock | UserBlock)[]).push(...message.content);
    } else {
      out.push({ role: message.role, content: [...message.content] } as ModelMessage);
    }
  };
  const isUserText = (row: ChatMessageRow) => row.role === "user" && Boolean(row.content.trim());
  const lastUser = rows.findLastIndex(isUserText);

  rows.forEach((row, index) => {
    if (toolCallIdOf(row.data)) return;
    if (isUserText(row)) {
      push({ role: "user", content: [{ type: "text", text: row.content }, { type: "text", text: sentNote(row, timeZone) }] });
      turnStarts.push(out.length - 1);
      return;
    }
    if (row.role === "user") return;
    if (!isAgentStep(row.data)) {
      push({ role: "user", content: [{ type: "text", text: appNote(row) }] });
      return;
    }
    const blocks = storedBlocks(row, index > lastUser);
    if (blocks.length === 0) return;
    push({ role: "assistant", content: blocks });
    const uses = blocks.filter(isToolUse);
    if (uses.length > 0) {
      push({ role: "user", content: uses.map((use) => toolResultBlock(byCallId.get(use.id), use.id)) });
    }
  });

  const cut = turnStarts.length > HISTORY_TURNS ? (turnStarts[turnStarts.length - HISTORY_TURNS] ?? 0) : 0;
  const kept = out.slice(cut);
  while (kept[0] && kept[0].role !== "user") kept.shift();
  const first = kept[0];
  if (first && cut > 0) {
    // Results whose tool_use was cut away would be orphans.
    kept[0] = { role: "user", content: (first.content as UserBlock[]).filter((block) => block.type !== "tool_result") };
  }
  return kept;
}
