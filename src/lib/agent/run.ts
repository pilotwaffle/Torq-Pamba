import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages, type Workspace } from "@/db/schema";
import {
  currentConversation,
  getConversation,
  rejectOpenConfirmations,
  touchConversation,
} from "@/lib/agent/conversation";
import type { EmitAgentEvent } from "@/lib/agent/events";
import { runAgentSteps } from "@/lib/agent/loop";
import { resolveAgentModel, type AgentModel } from "@/lib/agent/model";
import { isVideoPlan } from "@/lib/agent/plan";
import type { Tier } from "@/lib/pricing";
import { BudgetExceededError, generateVideo } from "@/lib/router";

const TIERS = new Set<Tier>(["budget", "standard", "premium"]);

/**
 * One chat turn: store the user's message in the conversation, then run the
 * agent loop. The model is Claude when live and keyed, otherwise the keyless
 * matcher (see `resolveAgentModel`).
 */
export async function handleUserMessage(input: {
  workspace: Workspace;
  userId: string;
  text: string;
  conversationId?: string;
  model?: AgentModel;
  emit?: EmitAgentEvent;
}): Promise<{ conversationId: string; paused: boolean } | null> {
  const content = input.text.trim().slice(0, 2000);
  if (!content) return null;
  const emit = input.emit ?? (() => {});
  const model = input.model ?? resolveAgentModel();
  const conversation =
    (input.conversationId ? await getConversation(input.workspace.id, input.conversationId) : null) ??
    (await currentConversation(input.workspace.id, input.userId));

  const db = await getDb();
  await db.insert(chatMessages).values({
    workspaceId: input.workspace.id,
    userId: input.userId,
    conversationId: conversation.id,
    role: "user",
    content,
  });
  await rejectOpenConfirmations(input.workspace.id, conversation.id);
  await touchConversation(conversation, { model: model.id, firstText: content });
  emit({ type: "turn", conversationId: conversation.id, model: model.id });

  const { paused } = await runAgentSteps({ workspace: input.workspace, userId: input.userId, conversation, model, emit });
  return { conversationId: conversation.id, paused };
}

export async function generateFromMessage(input: {
  workspaceId: string;
  userId: string;
  messageId: string;
  tier: Tier;
  hookIndex: number;
  /** Posts the finished message. Defaults to a new assistant message in the plan's conversation. */
  reply?: (content: string, data: Record<string, unknown>) => Promise<void>;
}): Promise<{ ok: true; videoId: string } | { ok: false; error: string }> {
  const db = await getDb();
  const [message] = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.id, input.messageId), eq(chatMessages.workspaceId, input.workspaceId)))
    .limit(1);
  const data = message?.data as { kind?: string; plan?: unknown; generatedVideoId?: string } | null;
  if (!message || !isVideoPlan(data?.plan)) return { ok: false, error: "That plan is no longer available." };
  if (data?.generatedVideoId) return { ok: true, videoId: data.generatedVideoId };

  const plan = data.plan;
  const hook = plan.hooks[input.hookIndex] ?? plan.hooks[0];
  let result: Awaited<ReturnType<typeof generateVideo>>;
  try {
    result = await generateVideo({
      workspaceId: input.workspaceId,
      tier: input.tier,
      title: plan.title,
      prompt: plan.sourcePrompt,
      avatarId: plan.avatarId,
      hook,
      voiceLines: plan.scenes.map((scene) => scene.line),
      scenes: plan.scenes,
      notifyUserId: input.userId,
      notifyConversationId: message.conversationId,
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, error: error.message };
    throw error;
  }
  if (!result.ok) return result;

  await db
    .update(chatMessages)
    .set({ data: { ...data, kind: "plan", plan: { ...plan, tier: input.tier }, generatedVideoId: result.videoId } })
    .where(eq(chatMessages.id, message.id));
  const post = async (content: string, posted: Record<string, unknown>) => {
    if (input.reply) {
      await input.reply(content, posted);
      return;
    }
    await db.insert(chatMessages).values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      conversationId: message.conversationId,
      role: "assistant",
      content,
      data: posted,
    });
  };
  if (result.pending) {
    await post("The clip is still generating. I'll post here when the final video is ready.", { kind: "note" });
    return { ok: true, videoId: result.videoId };
  }
  await post("The clip finished generating.", {
    kind: "ready",
    videoId: result.videoId,
    attemptSummary: result.attemptSummary,
  });
  return { ok: true, videoId: result.videoId };
}

/** Every message in the workspace, oldest first, across conversations. */
export async function listChat(workspaceId: string) {
  const db = await getDb();
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.workspaceId, workspaceId))
    .orderBy(asc(chatMessages.createdAt));
}

export function tierFromForm(value: string): Tier {
  return TIERS.has(value as Tier) ? (value as Tier) : "standard";
}
