import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { invites, members, users, workspaces, type Workspace } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(100),
  budgetCapUsd: z.number().finite().min(0).max(1_000_000),
  aiDisclosureDefault: z.boolean(),
  confirmDisableAiDisclosure: z.boolean(),
});

function isTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

async function requireManager(workspaceId: string, userId: string) {
  const db = await getDb();
  const [membership] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)))
    .limit(1);
  if (!membership || membership.role === "member") {
    throw new WorkspaceError("Only owners and admins can change workspace settings");
  }
  return membership;
}

export async function getWorkspace(workspaceId: string): Promise<Workspace | null> {
  const db = await getDb();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return workspace ?? null;
}

export async function getWorkspaceForUser(userId: string) {
  const db = await getDb();
  const rows = await db
    .select({ membership: members, workspace: workspaces })
    .from(members)
    .innerJoin(workspaces, eq(members.workspaceId, workspaces.id))
    .where(eq(members.userId, userId))
    .orderBy(asc(members.createdAt));
  return rows.find((row) => row.membership.role === "owner") ?? rows[0] ?? null;
}

export async function updateWorkspace(input: {
  workspaceId: string;
  actorUserId: string;
  name: string;
  timezone: string;
  budgetCapUsd: number;
  aiDisclosureDefault: boolean;
  confirmDisableAiDisclosure: boolean;
}) {
  await requireManager(input.workspaceId, input.actorUserId);
  const parsed = updateSchema.safeParse({
    name: input.name,
    timezone: input.timezone,
    budgetCapUsd: input.budgetCapUsd,
    aiDisclosureDefault: input.aiDisclosureDefault,
    confirmDisableAiDisclosure: input.confirmDisableAiDisclosure,
  });
  if (!parsed.success) {
    throw new WorkspaceError("Check the workspace name, timezone, and monthly budget cap");
  }
  if (!isTimeZone(parsed.data.timezone)) {
    throw new WorkspaceError("Enter a valid IANA timezone, such as UTC or America/Chicago");
  }

  const budgetCapUsd = Math.round(parsed.data.budgetCapUsd * 100) / 100;
  const db = await getDb();
  const current = await getWorkspace(input.workspaceId);
  if (!current) throw new WorkspaceError("Workspace not found");

  const turningOff = current.aiDisclosureDefault && !parsed.data.aiDisclosureDefault;
  if (turningOff && !parsed.data.confirmDisableAiDisclosure) {
    throw new WorkspaceError("Turning off AI disclosure requires confirmation");
  }

  const [updated] = await db
    .update(workspaces)
    .set({
      name: parsed.data.name,
      timezone: parsed.data.timezone,
      budgetCapUsd,
      aiDisclosureDefault: parsed.data.aiDisclosureDefault,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, input.workspaceId))
    .returning();
  if (!updated) throw new WorkspaceError("Workspace not found");

  await writeAudit({
    workspaceId: updated.id,
    actor: input.actorUserId,
    action: "workspace.updated",
    data: {
      name: updated.name,
      timezone: updated.timezone,
      budgetCapUsd,
      aiDisclosureDefault: updated.aiDisclosureDefault,
    },
  });

  if (current.aiDisclosureDefault !== updated.aiDisclosureDefault) {
    await writeAudit({
      workspaceId: updated.id,
      actor: input.actorUserId,
      action: "ai_disclosure.changed",
      data: {
        from: current.aiDisclosureDefault,
        to: updated.aiDisclosureDefault,
      },
    });
  }

  return updated;
}

export async function listMembers(workspaceId: string) {
  const db = await getDb();
  return db
    .select({
      id: members.id,
      userId: users.id,
      email: users.email,
      role: members.role,
      createdAt: members.createdAt,
    })
    .from(members)
    .innerJoin(users, eq(members.userId, users.id))
    .where(eq(members.workspaceId, workspaceId))
    .orderBy(asc(members.createdAt));
}

export async function createInvite(input: {
  workspaceId: string;
  actorUserId: string;
  role?: "admin" | "member";
}) {
  await requireManager(input.workspaceId, input.actorUserId);
  const role = input.role ?? "member";
  if (role !== "admin" && role !== "member") {
    throw new WorkspaceError("Invite role must be admin or member");
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const db = await getDb();
  const [invite] = await db
    .insert(invites)
    .values({
      workspaceId: input.workspaceId,
      token,
      role,
      expiresAt,
      createdBy: input.actorUserId,
    })
    .returning();
  if (!invite) throw new WorkspaceError("Could not create the invite");

  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actorUserId,
    action: "invite.created",
    data: { inviteId: invite.id, role, expiresAt: expiresAt.toISOString() },
  });

  return {
    id: invite.id,
    token: invite.token,
    role,
    expiresAt: new Date(invite.expiresAt),
    path: `/invite/${invite.token}`,
  };
}

export async function acceptInvite(token: string, userId: string) {
  const db = await getDb();
  const [invite] = await db.select().from(invites).where(eq(invites.token, token)).limit(1);
  if (!invite) throw new WorkspaceError("Invite not found");

  const [existing] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspaceId, invite.workspaceId), eq(members.userId, userId)))
    .limit(1);
  if (existing) return existing;

  if (invite.acceptedAt) throw new WorkspaceError("Invite already used");
  if (invite.expiresAt.getTime() <= Date.now()) throw new WorkspaceError("Invite expired");
  if (invite.role === "owner") throw new WorkspaceError("Invite role must be admin or member");

  const [member] = await db
    .insert(members)
    .values({
      workspaceId: invite.workspaceId,
      userId,
      role: invite.role,
    })
    .returning();
  if (!member) throw new WorkspaceError("Could not accept the invite");

  await db
    .update(invites)
    .set({ acceptedAt: new Date(), acceptedBy: userId })
    .where(eq(invites.id, invite.id));

  await writeAudit({
    workspaceId: invite.workspaceId,
    actor: userId,
    action: "invite.accepted",
    data: { inviteId: invite.id, role: invite.role },
  });

  return member;
}
