import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages, type Workspace } from "@/db/schema";
import { isVideoPlan } from "@/lib/agent/plan";
import { chatTools, type ChatToolContext } from "@/lib/agent/tools/registry";
import type { Tier } from "@/lib/pricing";
import { BudgetExceededError, generateVideo } from "@/lib/router";

const TIERS = new Set<Tier>(["budget", "standard", "premium"]);

const FALLBACK =
  "I can plan a video (“make a 30s video about …”), schedule an approved video, or tell you what’s scheduled.";

export async function handleUserMessage(input: {
  workspace: Workspace;
  userId: string;
  text: string;
}): Promise<void> {
  const content = input.text.trim().slice(0, 2000);
  if (!content) return;
  const db = await getDb();
  await db.insert(chatMessages).values({
    workspaceId: input.workspace.id,
    userId: input.userId,
    role: "user",
    content,
  });

  const ctx: ChatToolContext = {
    workspace: input.workspace,
    userId: input.userId,
    text: content,
    reply: (message, data) => insertAssistant(input.workspace.id, input.userId, message, data),
  };
  const found = chatTools.match(content);
  if (found) {
    await found.tool.run(ctx, found.args);
    return;
  }
  await ctx.reply(FALLBACK, { kind: "note" });
}

export async function generateFromMessage(input: {
  workspaceId: string;
  userId: string;
  messageId: string;
  tier: Tier;
  hookIndex: number;
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
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, error: error.message };
    throw error;
  }
  if (!result.ok) return result;

  await db
    .update(chatMessages)
    .set({ data: { kind: "plan", plan: { ...plan, tier: input.tier }, generatedVideoId: result.videoId } })
    .where(eq(chatMessages.id, message.id));
  if (result.pending) {
    await insertAssistant(input.workspaceId, input.userId, "The clip is still generating. I'll post here when the final video is ready.", {
      kind: "note",
    });
    return { ok: true, videoId: result.videoId };
  }
  await insertAssistant(input.workspaceId, input.userId, "The clip finished generating.", {
    kind: "ready",
    videoId: result.videoId,
    attemptSummary: result.attemptSummary,
  });
  return { ok: true, videoId: result.videoId };
}

async function insertAssistant(
  workspaceId: string,
  userId: string,
  content: string,
  data: Record<string, unknown>,
) {
  const db = await getDb();
  await db.insert(chatMessages).values({
    workspaceId,
    userId,
    role: "assistant",
    content,
    data,
  });
}

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
