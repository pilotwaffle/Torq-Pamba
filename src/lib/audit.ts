import { getDb, type AppDb } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditEntry = {
  workspaceId: string;
  actor: string;
  action: string;
  data?: Record<string, unknown> | null;
};

type AuditWriter = Pick<AppDb, "insert">;

export async function writeAudit(entry: AuditEntry, db?: AuditWriter): Promise<void> {
  const executor = db ?? (await getDb());
  await executor.insert(auditLog).values({
    workspaceId: entry.workspaceId,
    actor: entry.actor,
    action: entry.action,
    data: entry.data ?? {},
  });
}
