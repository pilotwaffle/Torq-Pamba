import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { members, users, workspaces } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "./password";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

const signupSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
  workspaceName: z.string().min(1).max(120),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === "23505") return true;
    if (typeof record.message === "string" && /duplicate key|unique constraint/i.test(record.message)) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

export async function signupAccount(input: {
  email: string;
  password: string;
  workspaceName: string;
}) {
  const parsed = signupSchema.safeParse({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    workspaceName: input.workspaceName.trim(),
  });
  if (!parsed.success) {
    throw new AuthError(
      "Enter a valid email, a password of at least 8 characters, and a workspace name.",
    );
  }

  const db = await getDb();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);
  if (existing) throw new AuthError("An account with that email already exists");

  const passwordHash = await hashPassword(parsed.data.password);

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: parsed.data.email, passwordHash })
        .returning();
      if (!user) throw new AuthError("Could not create the account");

      const [workspace] = await tx
        .insert(workspaces)
        .values({
          name: parsed.data.workspaceName,
          timezone: "UTC",
          onboardingStep: 1,
          budgetCapUsd: 25,
          aiDisclosureDefault: true,
          plan: "free",
        })
        .returning();
      if (!workspace) throw new AuthError("Could not create the workspace");

      await tx.insert(members).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      });

      await writeAudit(
        {
          workspaceId: workspace.id,
          actor: user.id,
          action: "workspace.created",
          data: { email: user.email, name: workspace.name },
        },
        tx,
      );

      return { user, workspace };
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (isUniqueViolation(error)) {
      throw new AuthError("An account with that email already exists");
    }
    throw error;
  }
}

export async function loginAccount(email: string, password: string) {
  const parsed = loginSchema.safeParse({
    email: email.trim().toLowerCase(),
    password,
  });
  if (!parsed.success) return null;

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const hash = user?.passwordHash ?? "scrypt$invalid";
  const matches = await verifyPassword(parsed.data.password, hash);
  if (!user || !matches) return null;
  return user;
}
