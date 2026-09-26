import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLog, invites, members } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signupAccount } from "@/lib/auth/account";
import { acceptInvite, createInvite } from "@/lib/workspace";

const password = "correct-horse-battery";

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

describe("password hashing", () => {
  it("stores a scrypt hash and verifies it", async () => {
    const hash = await hashPassword(password);
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
    expect(await verifyPassword(password, "not-a-hash")).toBe(false);
  });
});

describe("signup", () => {
  it("creates a workspace, an owner membership, and an audit log entry", async () => {
    const email = uniqueEmail("owner");
    const { user, workspace } = await signupAccount({
      email,
      password,
      workspaceName: "Northwind",
    });

    expect(user.email).toBe(email);
    expect(workspace.name).toBe("Northwind");
    expect(workspace.aiDisclosureDefault).toBe(true);
    expect(workspace.budgetCapUsd).toBe(25);

    const db = await getDb();
    const membership = await db.select().from(members).where(eq(members.userId, user.id));
    expect(membership).toHaveLength(1);
    expect(membership[0]?.role).toBe("owner");
    expect(membership[0]?.workspaceId).toBe(workspace.id);

    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspace.id));
    expect(
      audits.some((entry) => entry.action === "workspace.created" && entry.actor === user.id),
    ).toBe(true);
  });
});

describe("invites", () => {
  it("expires 14 days after creation and rejects an expired invite", async () => {
    const owner = await signupAccount({
      email: uniqueEmail("inviter"),
      password,
      workspaceName: "Invite Co",
    });
    const guest = await signupAccount({
      email: uniqueEmail("guest"),
      password,
      workspaceName: "Guest Co",
    });

    const start = Date.now();
    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      actorUserId: owner.user.id,
    });
    const end = Date.now();
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    const delta = invite.expiresAt.getTime() - start;
    expect(delta).toBeGreaterThanOrEqual(fourteenDays - 2000);
    expect(delta).toBeLessThanOrEqual(fourteenDays + (end - start) + 2000);

    const db = await getDb();
    const [stored] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(stored?.expiresAt.getTime()).toBe(invite.expiresAt.getTime());

    await db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.id, invite.id));
    await expect(acceptInvite(invite.token, guest.user.id)).rejects.toThrow(/expired/i);
  });
});
