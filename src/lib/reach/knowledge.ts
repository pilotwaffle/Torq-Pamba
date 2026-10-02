import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { knowledgeTiles, type BrandBrief, type KnowledgeTile } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

/**
 * Knowledge tiles: short, reusable facts about what works for this brand.
 * Hook-test winners are written back here automatically (source "experiment"),
 * and the hook generator and the chat planner read them first.
 */

export class KnowledgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeError";
  }
}

export const KNOWLEDGE_KINDS = ["hook", "angle", "audience", "format", "insight"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export const KNOWLEDGE_LABEL: Record<KnowledgeKind, string> = {
  hook: "Hook",
  angle: "Angle",
  audience: "Audience",
  format: "Format",
  insight: "Insight",
};

export function isKnowledgeKind(value: unknown): value is KnowledgeKind {
  return typeof value === "string" && (KNOWLEDGE_KINDS as readonly string[]).includes(value);
}

export function validateTile(input: { kind: string; title: string; body: string }): string[] {
  const errors: string[] = [];
  if (!isKnowledgeKind(input.kind)) errors.push("Choose a tile type");
  if (!input.title.trim()) errors.push("Title is required");
  if (input.title.trim().length > 120) errors.push("Title must be 120 characters or fewer");
  if (input.body.length > 1000) errors.push("Notes must be 1000 characters or fewer");
  return errors;
}

export async function addTile(input: {
  workspaceId: string;
  kind: string;
  title: string;
  body?: string;
  source?: "manual" | "experiment" | "brief";
  evidence?: Record<string, unknown>;
  score?: number;
  experimentId?: string | null;
  actor?: string;
}): Promise<KnowledgeTile> {
  const body = input.body ?? "";
  const errors = validateTile({ kind: input.kind, title: input.title, body });
  if (errors.length > 0) throw new KnowledgeError(errors[0] ?? "Invalid tile");
  const db = await getDb();
  const [row] = await db
    .insert(knowledgeTiles)
    .values({
      workspaceId: input.workspaceId,
      kind: input.kind as KnowledgeKind,
      title: input.title.trim(),
      body: body.trim(),
      source: input.source ?? "manual",
      evidence: input.evidence ?? {},
      score: Math.round(input.score ?? 0),
      experimentId: input.experimentId ?? null,
      createdBy: input.actor ?? "user",
    })
    .returning();
  if (!row) throw new KnowledgeError("Could not save the tile");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor ?? "user",
    action: "knowledge.written",
    data: { tileId: row.id, kind: row.kind, source: row.source },
  });
  return row;
}

export async function listTiles(workspaceId: string, options: { kind?: KnowledgeKind; includeArchived?: boolean } = {}) {
  const db = await getDb();
  const filters = [eq(knowledgeTiles.workspaceId, workspaceId)];
  if (options.kind) filters.push(eq(knowledgeTiles.kind, options.kind));
  if (!options.includeArchived) filters.push(isNull(knowledgeTiles.archivedAt));
  return db
    .select()
    .from(knowledgeTiles)
    .where(and(...filters))
    .orderBy(desc(knowledgeTiles.pinned), desc(knowledgeTiles.score), desc(knowledgeTiles.createdAt));
}

async function ownTile(workspaceId: string, tileId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(knowledgeTiles)
    .where(and(eq(knowledgeTiles.id, tileId), eq(knowledgeTiles.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new KnowledgeError("Tile not found");
  return row;
}

export async function archiveTile(workspaceId: string, tileId: string, actor = "user") {
  await ownTile(workspaceId, tileId);
  const db = await getDb();
  await db.update(knowledgeTiles).set({ archivedAt: new Date() }).where(eq(knowledgeTiles.id, tileId));
  await writeAudit({ workspaceId, actor, action: "knowledge.archived", data: { tileId } });
}

export async function togglePin(workspaceId: string, tileId: string) {
  const tile = await ownTile(workspaceId, tileId);
  const db = await getDb();
  await db.update(knowledgeTiles).set({ pinned: !tile.pinned }).where(eq(knowledgeTiles.id, tileId));
  return !tile.pinned;
}

/** Proven hooks (pinned first, then highest lift) and the patterns they used. */
export async function provenHooks(workspaceId: string, max = 3): Promise<{ hooks: string[]; patterns: string[] }> {
  const tiles = await listTiles(workspaceId, { kind: "hook" });
  const top = tiles.slice(0, max);
  const patterns = top
    .map((tile) => (typeof tile.evidence.pattern === "string" ? tile.evidence.pattern : ""))
    .filter((pattern) => pattern && pattern !== "control");
  return { hooks: top.map((tile) => tile.title), patterns: [...new Set(patterns)] };
}

/** Seeds audience and angle tiles from the brand brief once. Returns how many were added. */
export async function seedFromBrief(workspaceId: string, brief: BrandBrief | null | undefined, actor = "user"): Promise<number> {
  if (!brief) return 0;
  const existing = await listTiles(workspaceId, { includeArchived: true });
  const fromBrief = new Set(existing.filter((tile) => tile.source === "brief").map((tile) => `${tile.kind}:${tile.title}`));
  const candidates: { kind: KnowledgeKind; title: string; body: string }[] = [];
  if (brief.audience?.trim()) candidates.push({ kind: "audience", title: brief.audience.trim().slice(0, 120), body: "From the brand brief." });
  if (brief.whatTheyDo?.trim()) candidates.push({ kind: "angle", title: brief.whatTheyDo.trim().slice(0, 120), body: "Core promise, from the brand brief." });
  if (brief.tone?.trim()) candidates.push({ kind: "insight", title: `Tone: ${brief.tone.trim()}`.slice(0, 120), body: "Voice to keep across hooks and scripts." });
  let added = 0;
  for (const candidate of candidates) {
    if (fromBrief.has(`${candidate.kind}:${candidate.title}`)) continue;
    await addTile({ workspaceId, ...candidate, source: "brief", actor });
    added += 1;
  }
  return added;
}
