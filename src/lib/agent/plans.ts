import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages } from "@/db/schema";
import { isPlanMessage, type VideoPlan } from "@/lib/agent/plan";
import { listWorkspaceAvatars } from "@/lib/avatars/store";

export type PlanMessage = { messageId: string; plan: VideoPlan; generatedVideoId: string | null };

/** A plan message by id, or the newest plan in the workspace (optionally only one not generated yet). */
export async function findPlanMessage(
  workspaceId: string,
  messageId?: string,
  options: { ungenerated?: boolean } = {},
): Promise<PlanMessage | null> {
  const db = await getDb();
  const rows = await db
    .select({ id: chatMessages.id, data: chatMessages.data })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.workspaceId, workspaceId),
        messageId ? eq(chatMessages.id, messageId) : sql`${chatMessages.data}->>'kind' = 'plan'`,
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(messageId ? 1 : 25);
  for (const row of rows) {
    if (!isPlanMessage(row.data)) continue;
    const generated = (row.data as { generatedVideoId?: unknown }).generatedVideoId;
    const generatedVideoId = typeof generated === "string" ? generated : null;
    if (options.ungenerated && generatedVideoId) continue;
    return { messageId: row.id, plan: row.data.plan, generatedVideoId };
  }
  return null;
}

/** The named workspace avatar, else the default one. Throws when a name matches nothing. */
export async function resolveAvatar(workspaceId: string, name?: string) {
  const avatars = await listWorkspaceAvatars(workspaceId);
  if (name?.trim()) {
    const wanted = name.trim().toLowerCase();
    const found = avatars.find((avatar) => avatar.name.toLowerCase() === wanted);
    if (!found) {
      throw new Error(
        `No avatar named ${name.trim()}. This workspace has: ${avatars.map((avatar) => avatar.name).join(", ") || "none"}.`,
      );
    }
    return found;
  }
  return avatars.find((avatar) => avatar.isDefault) ?? avatars[0] ?? null;
}
