import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages, type Workspace } from "@/db/schema";
import { buildPlan, isVideoPlan, type VideoPlan } from "@/lib/agent/plan";
import { parseIntent } from "@/lib/agent/parse";
import { listWorkspaceAvatars } from "@/lib/avatars/store";
import { completeLive } from "@/lib/providers/llm";
import type { Tier } from "@/lib/pricing";
import { BudgetExceededError, generateVideo } from "@/lib/router";
import { formatWhen, listSchedule, scheduleApprovedVideo, scheduleStatusLabel, tomorrowAt } from "@/lib/schedule";
import { provenHooks } from "@/lib/reach/knowledge";

const TIERS = new Set<Tier>(["budget", "standard", "premium"]);

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

  const intent = parseIntent(content);
  if (intent.type === "plan") {
    await replyWithPlan(input.workspace, input.userId, content, intent);
    return;
  }
  if (intent.type === "schedule") {
    const when =
      intent.when === "tomorrow-9am"
        ? tomorrowAt(new Date(), input.workspace.timezone, 9, 0)
        : "next";
    const result = await scheduleApprovedVideo({
      workspaceId: input.workspace.id,
      actor: input.userId,
      when,
    });
    const message = result.ok
      ? `Scheduled “${result.title}” for ${formatWhen(result.scheduledAt, input.workspace.timezone)}.`
      : result.message;
    await insertAssistant(input.workspace.id, input.userId, message, { kind: "note" });
    return;
  }
  if (intent.type === "list-schedule") {
    const items = await listSchedule(input.workspace.id);
    const message =
      items.length === 0
        ? "Nothing is scheduled."
        : items
            .map(
              (item) =>
                `${item.title || "Untitled"} — ${formatWhen(item.scheduledAt, input.workspace.timezone)} (${scheduleStatusLabel(item.status)})`,
            )
            .join("\n");
    await insertAssistant(input.workspace.id, input.userId, message, { kind: "schedule", count: items.length });
    return;
  }
  await insertAssistant(
    input.workspace.id,
    input.userId,
    "I can plan a video (“make a 30s video about …”), schedule an approved video, or tell you what’s scheduled.",
    { kind: "note" },
  );
}

async function replyWithPlan(
  workspace: Workspace,
  userId: string,
  content: string,
  intent: { count: number; durationS: number; topic: string },
) {
  const avatars = await listWorkspaceAvatars(workspace.id);
  const avatar = avatars.find((item) => item.isDefault) ?? avatars[0] ?? null;
  const proven = await provenHooks(workspace.id).catch(() => ({ hooks: [] as string[], patterns: [] as string[] }));
  const plan = buildPlan({
    provenHooks: proven.hooks,
    topic: intent.topic,
    count: intent.count,
    durationS: intent.durationS,
    sourcePrompt: content,
    brief: workspace.brief,
    avatar: avatar ? { id: avatar.id, name: avatar.name, look: avatar.look } : null,
  });
  const live = await completeLive(planSystem(), planUser(plan)).catch(() => null);
  const lead =
    live?.trim() ||
    `Here’s a ${plan.durationS}s plan${plan.count > 1 ? ` (video 1 of ${plan.count})` : ""}. Nothing is generated until you click Generate.`;
  await insertAssistant(workspace.id, userId, lead, { kind: "plan", plan });
}

function planSystem(): string {
  return "You write a short UGC video plan. Do not publish the video. Do not add a watermark or logo. Reply in plain sentences.";
}

function planUser(plan: VideoPlan): string {
  return `Topic: ${plan.topic}\nBrand: ${plan.scenes.map((scene) => scene.line).join(" ")}`;
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
