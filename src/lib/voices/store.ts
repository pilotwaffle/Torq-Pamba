import { and, asc, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { avatars, voices, type Voice } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { registry } from "@/lib/providers/registry";
import { ensureStockVoices, STOCK_VOICE_CATALOG, stockVoiceByProviderId, stockVoiceBySlug } from "./catalog";

export type Avatar = typeof avatars.$inferSelect;

export class VoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceError";
  }
}

/** The lip-sync engine an avatar uses when `avatars.lipsync_model` is unset. */
export const DEFAULT_LIPSYNC_MODEL = "heygen-avatar-iv";

export function lipsyncModels(): { id: string; label: string }[] {
  return registry.list("lipsync").map((provider) => ({ id: provider.id, label: provider.label }));
}

/** Stock voices first (catalog order), then this workspace's ready clones by creation time. */
export async function listVoices(workspaceId: string): Promise<Voice[]> {
  await ensureStockVoices();
  const db = await getDb();
  const rows = await db
    .select()
    .from(voices)
    .where(and(isNull(voices.archivedAt), or(isNull(voices.workspaceId), eq(voices.workspaceId, workspaceId))))
    .orderBy(asc(voices.createdAt));
  const order = new Map(STOCK_VOICE_CATALOG.map((voice, index) => [voice.providerVoiceId, index]));
  const rank = (voice: Voice) =>
    voice.kind === "stock" ? (order.get(voice.providerVoiceId) ?? STOCK_VOICE_CATALOG.length) : 1000;
  return rows
    .filter((voice) => voice.kind === "clone" || order.has(voice.providerVoiceId))
    .sort((a, b) => rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime());
}

/** A voice this workspace may use: shared stock or its own clone, not archived. */
export async function getVoice(workspaceId: string, voiceId: string): Promise<Voice | null> {
  if (!/^[0-9a-f-]{36}$/i.test(voiceId)) return null;
  const db = await getDb();
  const [voice] = await db
    .select()
    .from(voices)
    .where(
      and(
        eq(voices.id, voiceId),
        isNull(voices.archivedAt),
        or(isNull(voices.workspaceId), eq(voices.workspaceId, workspaceId)),
      ),
    )
    .limit(1);
  return voice ?? null;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bvoice\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Matches a spoken voice name ("warm alto", "Rachel", "my clone Sam") to a voice. */
export async function findVoiceByName(workspaceId: string, name: string): Promise<Voice | null> {
  const wanted = normalize(name);
  if (!wanted) return null;
  const all = await listVoices(workspaceId);
  return (
    all.find((voice) => normalize(voice.name) === wanted) ??
    all.find((voice) => normalize(voice.description ?? "").split(" ").includes(wanted)) ??
    all.find((voice) => normalize(voice.name).includes(wanted) || wanted.includes(normalize(voice.name))) ??
    null
  );
}

/** Mock audio pitch for a voice: the catalog's for stock voices, a stable value per clone. */
export function mockPitchFor(voice: Pick<Voice, "kind" | "providerVoiceId">): number {
  const stock = voice.kind === "stock" ? stockVoiceByProviderId(voice.providerVoiceId) : undefined;
  if (stock) return stock.mockPitchHz;
  let hash = 0;
  for (const char of voice.providerVoiceId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 110 + (hash % 130);
}

export async function getAvatar(workspaceId: string, avatarId: string): Promise<Avatar | null> {
  if (!/^[0-9a-f-]{36}$/i.test(avatarId)) return null;
  const db = await getDb();
  const [avatar] = await db
    .select()
    .from(avatars)
    .where(and(eq(avatars.id, avatarId), eq(avatars.workspaceId, workspaceId)))
    .limit(1);
  return avatar ?? null;
}

/** The voice an avatar speaks with: its chosen voice, else the stock voice matching its legacy label. */
export async function resolveAvatarVoice(workspaceId: string, avatar: Avatar): Promise<Voice> {
  if (avatar.ttsVoiceId) {
    const chosen = await getVoice(workspaceId, avatar.ttsVoiceId);
    if (chosen) return chosen;
  }
  const all = await listVoices(workspaceId);
  const legacy = stockVoiceBySlug(avatar.voiceId);
  const fallback =
    (legacy && all.find((voice) => voice.kind === "stock" && voice.providerVoiceId === legacy.providerVoiceId)) ??
    all.find((voice) => voice.kind === "stock");
  if (!fallback) throw new VoiceError("No voices are available");
  return fallback;
}

export function lipsyncModelFor(avatar: Pick<Avatar, "lipsyncModel">): string {
  const ids = new Set(lipsyncModels().map((model) => model.id));
  return avatar.lipsyncModel && ids.has(avatar.lipsyncModel) ? avatar.lipsyncModel : DEFAULT_LIPSYNC_MODEL;
}

export async function setAvatarVoice(input: {
  workspaceId: string;
  actorUserId: string;
  avatarId: string;
  voiceId: string;
  lipsyncModel?: string;
}): Promise<{ avatar: Avatar; voice: Voice }> {
  const avatar = await getAvatar(input.workspaceId, input.avatarId);
  if (!avatar) throw new VoiceError("Unknown avatar");
  const voice = await getVoice(input.workspaceId, input.voiceId);
  if (!voice) throw new VoiceError("Unknown voice");
  let lipsyncModel = avatar.lipsyncModel;
  if (input.lipsyncModel) {
    if (!lipsyncModels().some((model) => model.id === input.lipsyncModel)) throw new VoiceError("Unknown lip-sync engine");
    lipsyncModel = input.lipsyncModel;
  }
  const db = await getDb();
  const [updated] = await db
    .update(avatars)
    .set({ ttsVoiceId: voice.id, lipsyncModel })
    .where(and(eq(avatars.id, avatar.id), eq(avatars.workspaceId, input.workspaceId)))
    .returning();
  if (!updated) throw new VoiceError("Could not save the voice");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actorUserId,
    action: "avatar.voice_selected",
    data: { avatarId: avatar.id, voiceId: voice.id, voiceName: voice.name, lipsyncModel },
  });
  return { avatar: updated, voice };
}
