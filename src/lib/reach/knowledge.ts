import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { knowledgeItems, type BrandBrief, type KnowledgeItem } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

/**
 * Knowledge tiles: short, reusable facts about what works for this brand,
 * stored in the foundation's `knowledge_items`. Hook-test winners are written
 * back here automatically (source "analytics", origin "experiment"), and the
 * hook generator and the chat planner read them first.
 */

export class KnowledgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeError";
  }
}

/**
 * Kinds come from the foundation's `knowledge_kind` enum. Phase 3's tile types
 * map onto it: hook -> hook_result, audience -> brand_fact, insight -> learning;
 * `angle` and `format` were appended to the enum in 0005.
 */
export const KNOWLEDGE_KINDS = ["hook_result", "angle", "brand_fact", "format", "learning", "preference", "rule"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export const KNOWLEDGE_LABEL: Record<KnowledgeKind, string> = {
  hook_result: "Hook",
  angle: "Angle",
  brand_fact: "Brand fact",
  format: "Format",
  learning: "Learning",
  preference: "Preference",
  rule: "Rule",
};

/** Where a tile came from. Stored as `source_ref.origin`; `source` holds the foundation's user | agent | analytics. */
export type TileOrigin = "manual" | "experiment" | "brief";
const SOURCE_OF: Record<TileOrigin, KnowledgeItem["source"]> = { manual: "user", brief: "user", experiment: "analytics" };

export function originOf(item: Pick<KnowledgeItem, "source" | "sourceRef">): string {
  const origin = item.sourceRef?.origin;
  return typeof origin === "string" ? origin : item.source;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  source?: TileOrigin;
  evidence?: Record<string, unknown>;
  score?: number;
  experimentId?: string | null;
  actor?: string;
}): Promise<KnowledgeItem> {
  const body = input.body ?? "";
  const origin = input.source ?? "manual";
  const errors = validateTile({ kind: input.kind, title: input.title, body });
  if (errors.length > 0) throw new KnowledgeError(errors[0] ?? "Invalid tile");
  const db = await getDb();
  const [row] = await db
    .insert(knowledgeItems)
    .values({
      workspaceId: input.workspaceId,
      kind: input.kind as KnowledgeKind,
      title: input.title.trim(),
      content: body.trim(),
      source: SOURCE_OF[origin],
      sourceRef: { ...(input.evidence ?? {}), origin, ...(input.experimentId ? { experimentId: input.experimentId } : {}) },
      score: Math.round(input.score ?? 0),
      createdBy: input.actor && UUID.test(input.actor) ? input.actor : null,
    })
    .returning();
  if (!row) throw new KnowledgeError("Could not save the tile");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor ?? "user",
    action: "knowledge.written",
    data: { tileId: row.id, kind: row.kind, source: row.source, origin },
  });
  return row;
}

export async function listTiles(workspaceId: string, options: { kind?: KnowledgeKind; includeArchived?: boolean } = {}) {
  const db = await getDb();
  const filters = [eq(knowledgeItems.workspaceId, workspaceId)];
  if (options.kind) filters.push(eq(knowledgeItems.kind, options.kind));
  if (!options.includeArchived) filters.push(isNull(knowledgeItems.archivedAt));
  return db
    .select()
    .from(knowledgeItems)
    .where(and(...filters))
    .orderBy(desc(knowledgeItems.pinned), desc(knowledgeItems.score), desc(knowledgeItems.createdAt));
}

async function ownTile(workspaceId: string, tileId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, tileId), eq(knowledgeItems.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new KnowledgeError("Tile not found");
  return row;
}

export async function archiveTile(workspaceId: string, tileId: string, actor = "user") {
  await ownTile(workspaceId, tileId);
  const db = await getDb();
  await db.update(knowledgeItems).set({ archivedAt: new Date() }).where(eq(knowledgeItems.id, tileId));
  await writeAudit({ workspaceId, actor, action: "knowledge.archived", data: { tileId } });
}

export async function togglePin(workspaceId: string, tileId: string) {
  const tile = await ownTile(workspaceId, tileId);
  const db = await getDb();
  await db.update(knowledgeItems).set({ pinned: !tile.pinned }).where(eq(knowledgeItems.id, tileId));
  return !tile.pinned;
}

/** Proven hooks (pinned first, then highest lift) and the patterns they used. */
export async function provenHooks(workspaceId: string, max = 3): Promise<{ hooks: string[]; patterns: string[] }> {
  const tiles = await listTiles(workspaceId, { kind: "hook_result" });
  const top = tiles.slice(0, max);
  const patterns = top
    .map((tile) => {
      const pattern = tile.sourceRef?.pattern;
      return typeof pattern === "string" ? pattern : "";
    })
    .filter((pattern) => pattern && pattern !== "control");
  return { hooks: top.map((tile) => tile.title), patterns: [...new Set(patterns)] };
}

/** Seeds audience (brand fact), angle and tone (preference) tiles from the brand brief once. Returns how many were added. */
export async function seedFromBrief(workspaceId: string, brief: BrandBrief | null | undefined, actor = "user"): Promise<number> {
  if (!brief) return 0;
  const existing = await listTiles(workspaceId, { includeArchived: true });
  const fromBrief = new Set(existing.filter((tile) => originOf(tile) === "brief").map((tile) => `${tile.kind}:${tile.title}`));
  const candidates: { kind: KnowledgeKind; title: string; body: string }[] = [];
  if (brief.audience?.trim()) candidates.push({ kind: "brand_fact", title: brief.audience.trim().slice(0, 120), body: "From the brand brief." });
  if (brief.whatTheyDo?.trim()) candidates.push({ kind: "angle", title: brief.whatTheyDo.trim().slice(0, 120), body: "Core promise, from the brand brief." });
  if (brief.tone?.trim()) candidates.push({ kind: "preference", title: `Tone: ${brief.tone.trim()}`.slice(0, 120), body: "Voice to keep across hooks and scripts." });
  let added = 0;
  for (const candidate of candidates) {
    if (fromBrief.has(`${candidate.kind}:${candidate.title}`)) continue;
    await addTile({ workspaceId, ...candidate, source: "brief", actor });
    added += 1;
  }
  return added;
}
