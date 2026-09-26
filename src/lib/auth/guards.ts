import { redirect } from "next/navigation";
import { getWorkspaceForUser } from "@/lib/workspace";
import { readSession, type SessionUser } from "./session";

export async function requireUser(): Promise<SessionUser> {
  const session = await readSession();
  if (!session) redirect("/login");
  return session.user;
}

export async function requireWorkspace() {
  const user = await requireUser();
  const current = await getWorkspaceForUser(user.id);
  if (!current) redirect("/login");
  return {
    user,
    workspace: current.workspace,
    role: current.membership.role,
  };
}
