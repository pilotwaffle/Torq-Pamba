import { getDb } from "@/db";
import { chatMessages, type Workspace } from "@/db/schema";
import { isPlanMessage } from "@/lib/agent/plan";
import { planTool } from "@/lib/agent/tools/plan";
import type { ChatToolContext } from "@/lib/agent/tools/types";
import { writeAudit } from "@/lib/audit";
import { getIdea, setIdeaStatus } from "./ideas";
import { ResearchError } from "./types";

export const IDEA_VIDEO_SECONDS = 30;

/** The chat request "Make this video" sends for an idea. */
export function ideaRequest(title: string): string {
  const topic = title.replace(/[.!?…]+$/u, "").trim();
  return `Make a ${IDEA_VIDEO_SECONDS}s video about ${topic}`;
}

/** Puts the idea's hook first, keeping exactly three distinct hooks. */
export function withIdeaHook(hooks: readonly string[], hook: string | null): [string, string, string] {
  const first = hook?.trim();
  const rest = hooks.filter((item) => item.trim().toLowerCase() !== first?.toLowerCase());
  const ordered = first ? [first, ...rest] : [...hooks];
  return [ordered[0] ?? "", ordered[1] ?? "", ordered[2] ?? ""];
}

/**
 * "Make this video": posts the idea to chat as a make request and runs the
 * existing plan tool, so the user lands on the usual plan card with the cost
 * preview and Generate button. Nothing is generated or charged here. The plan
 * carries the idea id so the video can be linked back once it is generated.
 */
export async function makeVideoFromIdea(input: { workspace: Workspace; userId: string; ideaId: string }): Promise<void> {
  const idea = await getIdea(input.workspace.id, input.ideaId);
  if (!idea) throw new ResearchError("That idea is not in this workspace");
  const text = ideaRequest(idea.title);
  const db = await getDb();
  await db.insert(chatMessages).values({
    workspaceId: input.workspace.id,
    userId: input.userId,
    role: "user",
    content: text,
  });
  const ctx: ChatToolContext = {
    workspace: input.workspace,
    userId: input.userId,
    text,
    async reply(content, data) {
      const stored = isPlanMessage(data)
        ? {
            ...data,
            plan: { ...data.plan, hooks: withIdeaHook(data.plan.hooks, idea.hook), ideaId: idea.id },
          }
        : data;
      await db.insert(chatMessages).values({
        workspaceId: input.workspace.id,
        userId: input.userId,
        role: "assistant",
        content,
        data: stored,
      });
    },
  };
  await planTool.run(ctx, { count: 1, durationS: IDEA_VIDEO_SECONDS, topic: idea.title.replace(/[.!?…]+$/u, "").trim() });
  await setIdeaStatus(input.workspace.id, idea.id, "used");
  await writeAudit({
    workspaceId: input.workspace.id,
    actor: input.userId,
    action: "research.idea_planned",
    data: { ideaId: idea.id, title: idea.title },
  });
}
