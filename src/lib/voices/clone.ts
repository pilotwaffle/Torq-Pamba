import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { avatars, generationJobs, voiceClones, voiceCloneSamples, voices, type Voice, type VoiceClone } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { catalog } from "@/lib/models";
import { registry } from "@/lib/providers/registry";
import { storeMedia } from "./assets";
import {
  consentStatement,
  MAX_CLONE_SAMPLES,
  MAX_SAMPLE_BYTES,
  MIN_SAMPLE_BYTES,
  sniffAudio,
  type ConsentBasis,
} from "./consent";
import { VoiceError } from "./store";
import type { AudioFile, VoiceProvider } from "./types";
import { dataUrl, wavDurationMs } from "./wav";

export { consentStatement, MAX_CLONE_SAMPLES, MAX_SAMPLE_BYTES, sniffAudio, type ConsentBasis } from "./consent";

export class ConsentRequiredError extends VoiceError {
  constructor(message = "Confirm that this is your own voice or that you have the speaker’s permission before cloning.") {
    super(message);
    this.name = "ConsentRequiredError";
  }
}

/** Checks each sample's size and real format. Returns samples with a trustworthy mime type. */
export function validateSamples(samples: AudioFile[]): AudioFile[] {
  if (samples.length === 0) throw new VoiceError("Add at least one voice sample");
  if (samples.length > MAX_CLONE_SAMPLES) throw new VoiceError(`Add at most ${MAX_CLONE_SAMPLES} samples`);
  return samples.map((sample) => {
    if (sample.bytes.length < MIN_SAMPLE_BYTES) throw new VoiceError(`“${sample.filename}” is too short to clone from`);
    if (sample.bytes.length > MAX_SAMPLE_BYTES) throw new VoiceError(`“${sample.filename}” is over 5 MB`);
    const mimeType = sniffAudio(sample.bytes);
    if (!mimeType) throw new VoiceError(`“${sample.filename}” is not a WAV, MP3, M4A, OGG, WebM or FLAC recording`);
    return { ...sample, mimeType, filename: sample.filename.replace(/[^\w.\- ]+/g, "").slice(0, 80) || "sample" };
  });
}

function cleanName(value: string, field: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) throw new VoiceError(`Enter ${field}`);
  return trimmed.slice(0, max);
}

/** A clone request with no consent and no samples yet. Nothing goes to a provider. */
export async function startCloneDraft(input: {
  workspaceId: string;
  actorUserId: string;
  name: string;
  speakerName?: string;
}): Promise<VoiceClone> {
  const db = await getDb();
  const [clone] = await db
    .insert(voiceClones)
    .values({
      workspaceId: input.workspaceId,
      name: cleanName(input.name, "a name for the voice", 60),
      speakerName: (input.speakerName ?? "").trim().slice(0, 80),
      status: "awaiting_consent",
      createdBy: input.actorUserId,
    })
    .returning();
  if (!clone) throw new VoiceError("Could not start the voice clone");
  return clone;
}

/**
 * Records consent and samples, then clones the voice. Throws
 * `ConsentRequiredError` before writing anything when consent is missing. A
 * provider failure leaves the clone `failed` with its error, and no voice.
 */
export async function submitClone(input: {
  workspaceId: string;
  actorUserId: string;
  cloneId?: string;
  name: string;
  speakerName: string;
  basis: ConsentBasis;
  consent: boolean;
  samples: AudioFile[];
  resolve?: (id: string) => VoiceProvider;
}): Promise<{ clone: VoiceClone; voice: Voice | null }> {
  if (input.consent !== true || (input.basis !== "self" && input.basis !== "permission")) throw new ConsentRequiredError();
  const name = cleanName(input.name, "a name for the voice", 60);
  const speakerName = cleanName(input.speakerName, "the speaker’s name", 80);
  const samples = validateSamples(input.samples);
  const statement = consentStatement(input.basis, speakerName);
  const provider = (input.resolve ?? ((id: string) => registry.get("voice", id)))(catalog.voiceOver().id);

  const db = await getDb();
  const now = new Date();
  const consentFields = {
    name,
    speakerName,
    consentStatement: statement,
    consentedBy: input.actorUserId,
    consentedAt: now,
    status: "processing" as const,
    provider: provider.vendor,
    error: null,
    updatedAt: now,
  };
  let clone: VoiceClone | undefined;
  if (input.cloneId) {
    [clone] = await db
      .update(voiceClones)
      .set(consentFields)
      .where(
        and(
          eq(voiceClones.id, input.cloneId),
          eq(voiceClones.workspaceId, input.workspaceId),
          eq(voiceClones.status, "awaiting_consent"),
        ),
      )
      .returning();
    if (!clone) throw new VoiceError("That voice clone is no longer waiting for consent");
  } else {
    [clone] = await db
      .insert(voiceClones)
      .values({ workspaceId: input.workspaceId, createdBy: input.actorUserId, ...consentFields })
      .returning();
    if (!clone) throw new VoiceError("Could not start the voice clone");
  }

  for (const sample of samples) {
    const asset = await storeMedia({
      workspaceId: input.workspaceId,
      kind: "audio",
      source: "upload",
      url: dataUrl(sample.bytes, sample.mimeType),
      mimeType: sample.mimeType,
      bytes: sample.bytes,
      durationMs: wavDurationMs(sample.bytes),
      originalFilename: sample.filename,
      createdBy: input.actorUserId,
    });
    await db.insert(voiceCloneSamples).values({ cloneId: clone.id, assetId: asset.id });
  }
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actorUserId,
    action: "voice_clone.consented",
    data: { cloneId: clone.id, speakerName, basis: input.basis, statement, samples: samples.length },
  });

  const [job] = await db
    .insert(generationJobs)
    .values({
      workspaceId: input.workspaceId,
      kind: "voice_clone",
      provider: provider.id,
      status: "running",
      request: { cloneId: clone.id, samples: samples.length },
      submittedAt: new Date(),
    })
    .returning();
  await db.update(voiceClones).set({ jobId: job?.id ?? null }).where(eq(voiceClones.id, clone.id));

  try {
    const result = await provider.cloneVoice({ name, description: `Voice clone of ${speakerName}`, samples });
    const [voice] = await db
      .insert(voices)
      .values({
        workspaceId: input.workspaceId,
        kind: "clone",
        provider: result.provider,
        providerVoiceId: result.providerVoiceId,
        name,
        description: `Clone of ${speakerName}`,
      })
      .returning();
    if (!voice) throw new VoiceError("Could not save the cloned voice");
    const [ready] = await db
      .update(voiceClones)
      .set({ status: "ready", voiceId: voice.id, provider: result.provider, updatedAt: new Date() })
      .where(eq(voiceClones.id, clone.id))
      .returning();
    if (job) {
      await db
        .update(generationJobs)
        .set({
          status: "succeeded",
          providerJobId: null,
          response: { voiceId: voice.id, requiresVerification: result.requiresVerification },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(generationJobs.id, job.id));
    }
    return { clone: ready ?? clone, voice };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "Cloning failed").slice(0, 300);
    const [failed] = await db
      .update(voiceClones)
      .set({ status: "failed", error: reason, updatedAt: new Date() })
      .where(eq(voiceClones.id, clone.id))
      .returning();
    if (job) {
      await db
        .update(generationJobs)
        .set({ status: "failed", error: reason, costUsd: 0, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(generationJobs.id, job.id));
    }
    return { clone: failed ?? clone, voice: null };
  }
}

/** Revokes a clone: archives its voice, clears it from avatars, and deletes it at the vendor. */
export async function revokeClone(input: {
  workspaceId: string;
  actorUserId: string;
  cloneId: string;
  resolve?: (id: string) => VoiceProvider;
}): Promise<VoiceClone> {
  const db = await getDb();
  const [clone] = await db
    .select()
    .from(voiceClones)
    .where(and(eq(voiceClones.id, input.cloneId), eq(voiceClones.workspaceId, input.workspaceId)))
    .limit(1);
  if (!clone) throw new VoiceError("Unknown voice clone");
  if (clone.status === "revoked") return clone;
  const now = new Date();
  let vendorError: string | null = null;
  if (clone.voiceId) {
    const [voice] = await db.select().from(voices).where(eq(voices.id, clone.voiceId)).limit(1);
    await db.update(voices).set({ archivedAt: now }).where(eq(voices.id, clone.voiceId));
    await db
      .update(avatars)
      .set({ ttsVoiceId: null })
      .where(and(eq(avatars.workspaceId, input.workspaceId), eq(avatars.ttsVoiceId, clone.voiceId)));
    if (voice && voice.provider !== "mock") {
      const provider = (input.resolve ?? ((id: string) => registry.get("voice", id)))(catalog.voiceOver().id);
      await provider.deleteVoice(voice.providerVoiceId).catch((error: unknown) => {
        vendorError = (error instanceof Error ? error.message : "delete failed").slice(0, 300);
      });
    }
  }
  const [revoked] = await db
    .update(voiceClones)
    .set({ status: "revoked", revokedAt: now, updatedAt: now, error: vendorError })
    .where(eq(voiceClones.id, clone.id))
    .returning();
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actorUserId,
    action: "voice_clone.revoked",
    data: { cloneId: clone.id, voiceId: clone.voiceId, vendorError },
  });
  return revoked ?? clone;
}

export type CloneSummary = VoiceClone & { sampleCount: number };

export async function listClones(workspaceId: string): Promise<CloneSummary[]> {
  const db = await getDb();
  const rows = await db
    .select({
      clone: voiceClones,
      sampleCount: sql<number>`(select count(*) from ${voiceCloneSamples} where ${voiceCloneSamples.cloneId} = ${voiceClones.id})`,
    })
    .from(voiceClones)
    .where(eq(voiceClones.workspaceId, workspaceId))
    .orderBy(desc(voiceClones.createdAt));
  return rows.map((row) => ({ ...row.clone, sampleCount: Number(row.sampleCount) }));
}
