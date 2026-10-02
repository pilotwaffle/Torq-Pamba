import { and, eq, inArray, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { generationJobs, type GenerationJob, type Voice } from "@/db/schema";
import { catalog } from "@/lib/models";
import { registry } from "@/lib/providers/registry";
import { ProviderRefusedError } from "@/lib/providers/types";
import { getMedia, storeMedia } from "./assets";
import {
  getAvatar,
  getVoice,
  lipsyncModelFor,
  listVoices,
  mockPitchFor,
  resolveAvatarVoice,
  VoiceError,
} from "./store";
import type { LipsyncProgress, LipsyncProvider, VoiceProvider } from "./types";
import { dataUrl } from "./wav";

/** A synthesized line, stored as an audio `media_assets` row by a `voice` job. */
export type VoiceTrack = {
  jobId: string;
  voiceId: string;
  voiceName: string;
  /** Voice model id, e.g. `elevenlabs-v3`. */
  providerId: string;
  text: string;
  assetId: string;
  /** `data:audio/wav` from the mock, `data:audio/mpeg` from ElevenLabs. */
  url: string;
  mimeType: string;
  durationMs: number;
  costUsd: number;
  mock: boolean;
};

/** An avatar speaking a voice track, from a `lipsync` job. `running` until the vendor finishes. */
export type TalkingClip = {
  jobId: string;
  avatarId: string;
  /** Lip-sync engine id (`avatars.lipsync_model`), e.g. `heygen-avatar-iv`. */
  providerId: string;
  status: "running" | "succeeded" | "failed";
  assetId: string | null;
  /** `video/mp4` from a vendor; `image/svg+xml` (animated mouth, no audio) from the mock. */
  url: string | null;
  mimeType: string | null;
  posterUrl: string | null;
  durationMs: number;
  costUsd: number;
  error: string | null;
  /** Play this beside the clip when `mimeType` is not a video with its own soundtrack. */
  audio: VoiceTrack;
  mock: boolean;
};

export type VoiceResolvers = {
  voice?: (id: string) => VoiceProvider;
  lipsync?: (id: string) => LipsyncProvider;
};

const POLL_EVERY_MS = 10_000;
const LIPSYNC_DEADLINE_MS = 20 * 60_000;

function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function failureStatus(error: unknown): "refused" | "failed" {
  return error instanceof ProviderRefusedError ? "refused" : "failed";
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : "failed").slice(0, 300);
}

async function pickVoice(input: { workspaceId: string; voiceId?: string; avatarId?: string }): Promise<Voice> {
  if (input.voiceId) {
    const voice = await getVoice(input.workspaceId, input.voiceId);
    if (!voice) throw new VoiceError("Unknown voice");
    return voice;
  }
  if (input.avatarId) {
    const avatar = await getAvatar(input.workspaceId, input.avatarId);
    if (!avatar) throw new VoiceError("Unknown avatar");
    return resolveAvatarVoice(input.workspaceId, avatar);
  }
  const [first] = await listVoices(input.workspaceId);
  if (!first) throw new VoiceError("No voices are available");
  return first;
}

/**
 * Speaks `text` in a voice: `voiceId`, else the avatar's voice, else the first
 * stock voice. Records a `voice` job and an audio asset. On failure the job is
 * `failed` or `refused` with cost 0 and the error is rethrown.
 */
export async function speakLine(input: {
  workspaceId: string;
  text: string;
  voiceId?: string;
  avatarId?: string;
  /** Voice model id. Defaults to the catalog's voice-over model. */
  model?: string;
  videoId?: string | null;
  actorUserId?: string | null;
  resolve?: VoiceResolvers;
}): Promise<VoiceTrack> {
  const text = input.text.trim();
  if (!text) throw new VoiceError("There is no text to speak");
  const voice = await pickVoice(input);
  const providerId = input.model ?? catalog.voiceOver().id;
  const provider = (input.resolve?.voice ?? ((id: string) => registry.get("voice", id)))(providerId);
  if (text.length > provider.maxChars) throw new VoiceError(`${provider.label} takes up to ${provider.maxChars} characters`);
  if (voice.provider === "mock" && provider.isLive()) {
    throw new VoiceError(`“${voice.name}” was cloned without a provider key. Clone it again with live keys.`);
  }
  if (voice.provider !== "mock" && voice.provider !== provider.vendor) {
    throw new VoiceError(`“${voice.name}” is a ${voice.provider} voice and cannot use ${provider.label}`);
  }

  const db = await getDb();
  const [job] = await db
    .insert(generationJobs)
    .values({
      workspaceId: input.workspaceId,
      videoId: input.videoId ?? null,
      kind: "voice",
      provider: provider.id,
      model: provider.id,
      status: "running",
      request: { text, voiceId: voice.id, providerVoiceId: voice.providerVoiceId },
      submittedAt: new Date(),
    })
    .returning();
  if (!job) throw new VoiceError("Could not start the voice job");

  try {
    const result = await provider.synthesize({
      providerVoiceId: voice.providerVoiceId,
      text,
      mockPitchHz: mockPitchFor(voice),
    });
    const asset = await storeMedia({
      workspaceId: input.workspaceId,
      kind: "audio",
      source: "generated",
      url: dataUrl(result.audio.bytes, result.audio.mimeType),
      mimeType: result.audio.mimeType,
      bytes: result.audio.bytes,
      durationMs: result.durationMs,
      createdBy: input.actorUserId ?? null,
    });
    const costUsd = roundUsd(result.costUsd);
    const mock = !provider.isLive();
    await db
      .update(generationJobs)
      .set({
        status: "succeeded",
        outputAssetId: asset.id,
        costUsd,
        response: { durationMs: result.durationMs, mock },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, job.id));
    return {
      jobId: job.id,
      voiceId: voice.id,
      voiceName: voice.name,
      providerId: provider.id,
      text,
      assetId: asset.id,
      url: asset.url,
      mimeType: asset.mimeType,
      durationMs: result.durationMs,
      costUsd,
      mock,
    };
  } catch (error) {
    await db
      .update(generationJobs)
      .set({ status: failureStatus(error), error: message(error), costUsd: 0, completedAt: new Date(), updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id));
    throw error;
  }
}

/** Rebuilds a `VoiceTrack` from a succeeded `voice` job. */
export async function voiceTrackFromJob(workspaceId: string, jobId: string): Promise<VoiceTrack | null> {
  const db = await getDb();
  const [job] = await db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.workspaceId, workspaceId), eq(generationJobs.kind, "voice")))
    .limit(1);
  if (!job || job.status !== "succeeded") return null;
  const asset = await getMedia(workspaceId, job.outputAssetId);
  if (!asset) return null;
  const request = (job.request ?? {}) as { text?: string; voiceId?: string };
  const voice = request.voiceId ? await getVoice(workspaceId, request.voiceId) : null;
  return {
    jobId: job.id,
    voiceId: request.voiceId ?? "",
    voiceName: voice?.name ?? "",
    providerId: job.provider,
    text: request.text ?? "",
    assetId: asset.id,
    url: asset.url,
    mimeType: asset.mimeType,
    durationMs: asset.durationMs ?? 0,
    costUsd: Number(job.costUsd),
    mock: Boolean((job.response as { mock?: boolean } | null)?.mock),
  };
}

/**
 * Makes the avatar say `text` (or an existing `audio` track) with its lip-sync
 * engine. Records a `lipsync` job. Mock engines finish at once; vendor jobs
 * stay `running` until `refreshLipsyncJob` or `pollDueVoiceJobs` sees them done.
 */
export async function lipsyncLine(input: {
  workspaceId: string;
  avatarId: string;
  text?: string;
  audio?: VoiceTrack;
  /** Lip-sync engine id. Defaults to the avatar's `lipsync_model`. */
  model?: string;
  videoId?: string | null;
  actorUserId?: string | null;
  resolve?: VoiceResolvers;
}): Promise<TalkingClip> {
  const avatar = await getAvatar(input.workspaceId, input.avatarId);
  if (!avatar) throw new VoiceError("Unknown avatar");
  const audio =
    input.audio ??
    (await speakLine({
      workspaceId: input.workspaceId,
      avatarId: avatar.id,
      text: input.text ?? "",
      videoId: input.videoId,
      actorUserId: input.actorUserId,
      resolve: input.resolve,
    }));
  const providerId = input.model ?? lipsyncModelFor(avatar);
  const provider = (input.resolve?.lipsync ?? ((id: string) => registry.get("lipsync", id)))(providerId);
  if (audio.durationMs > provider.maxDurationS * 1000) {
    throw new VoiceError(`${provider.label} takes up to ${provider.maxDurationS}s of audio`);
  }
  const portrait = (await getMedia(input.workspaceId, avatar.portraitAssetId))?.url ?? avatar.image ?? "";
  if (!portrait) throw new VoiceError("This avatar has no portrait to animate");

  const db = await getDb();
  const now = new Date();
  const [job] = await db
    .insert(generationJobs)
    .values({
      workspaceId: input.workspaceId,
      videoId: input.videoId ?? null,
      kind: "lipsync",
      provider: provider.id,
      model: provider.id,
      status: "submitted",
      request: { avatarId: avatar.id, audioJobId: audio.jobId, audioAssetId: audio.assetId, text: audio.text },
      submittedAt: now,
      deadlineAt: new Date(now.getTime() + LIPSYNC_DEADLINE_MS),
    })
    .returning();
  if (!job) throw new VoiceError("Could not start the lip-sync job");

  try {
    const started = await provider.submit({
      imageUrl: portrait,
      audio: { url: audio.url, mimeType: audio.mimeType, durationMs: audio.durationMs },
      title: `${avatar.name}: ${audio.text}`.slice(0, 120),
      script: audio.text,
    });
    await db
      .update(generationJobs)
      .set({ providerJobId: started.providerJobId, status: "running", nextPollAt: new Date(Date.now() + POLL_EVERY_MS), updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id));
    const updated = await applyProgress(input.workspaceId, { ...job, providerJobId: started.providerJobId }, provider, started, input.actorUserId);
    return talkingClip(updated, audio, provider);
  } catch (error) {
    await db
      .update(generationJobs)
      .set({ status: failureStatus(error), error: message(error), costUsd: 0, completedAt: new Date(), updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id));
    throw error;
  }
}

async function applyProgress(
  workspaceId: string,
  job: GenerationJob,
  provider: LipsyncProvider,
  progress: LipsyncProgress,
  actorUserId?: string | null,
): Promise<GenerationJob> {
  const db = await getDb();
  const now = new Date();
  let patch: Partial<GenerationJob>;
  if (progress.status === "succeeded") {
    const asset = await storeMedia({
      workspaceId,
      kind: "video",
      source: "generated",
      url: progress.output.url,
      mimeType: progress.output.mimeType,
      durationMs: progress.output.durationMs,
      createdBy: actorUserId ?? null,
    });
    patch = {
      status: "succeeded",
      outputAssetId: asset.id,
      costUsd: roundUsd((provider.usdPerSecond * progress.output.durationMs) / 1000),
      response: { posterUrl: progress.output.posterUrl ?? null, mock: !provider.isLive() },
      completedAt: now,
      nextPollAt: null,
    };
  } else if (progress.status === "failed") {
    patch = { status: "failed", error: progress.error.slice(0, 300), costUsd: 0, completedAt: now, nextPollAt: null };
  } else if (job.deadlineAt && job.deadlineAt.getTime() <= now.getTime()) {
    patch = { status: "timed_out", error: "The lip-sync job did not finish in time", costUsd: 0, completedAt: now, nextPollAt: null };
  } else {
    patch = { status: "running", nextPollAt: new Date(now.getTime() + POLL_EVERY_MS) };
  }
  const [updated] = await db
    .update(generationJobs)
    .set({ ...patch, updatedAt: now })
    .where(eq(generationJobs.id, job.id))
    .returning();
  return updated ?? job;
}

async function talkingClip(job: GenerationJob, audio: VoiceTrack, provider: LipsyncProvider): Promise<TalkingClip> {
  const asset = await getMedia(job.workspaceId, job.outputAssetId);
  const status = job.status === "succeeded" ? "succeeded" : ["queued", "submitted", "running"].includes(job.status) ? "running" : "failed";
  const response = (job.response ?? {}) as { posterUrl?: string | null; mock?: boolean };
  return {
    jobId: job.id,
    avatarId: String((job.request as { avatarId?: string } | null)?.avatarId ?? ""),
    providerId: job.provider,
    status,
    assetId: asset?.id ?? null,
    url: asset?.url ?? null,
    mimeType: asset?.mimeType ?? null,
    posterUrl: response.posterUrl ?? null,
    durationMs: asset?.durationMs ?? audio.durationMs,
    costUsd: Number(job.costUsd),
    error: job.error,
    audio,
    mock: response.mock ?? !provider.isLive(),
  };
}

/** Polls a running `lipsync` job once and returns its current clip. Finished jobs are returned as stored. */
export async function refreshLipsyncJob(input: {
  workspaceId: string;
  jobId: string;
  resolve?: VoiceResolvers;
}): Promise<TalkingClip | null> {
  const db = await getDb();
  const [job] = await db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.id, input.jobId),
        eq(generationJobs.workspaceId, input.workspaceId),
        eq(generationJobs.kind, "lipsync"),
      ),
    )
    .limit(1);
  if (!job) return null;
  const provider = (input.resolve?.lipsync ?? ((id: string) => registry.get("lipsync", id)))(job.provider);
  const request = (job.request ?? {}) as { audioJobId?: string };
  const audio = request.audioJobId ? await voiceTrackFromJob(input.workspaceId, request.audioJobId) : null;
  if (!audio) return null;
  let current = job;
  if ((job.status === "running" || job.status === "submitted") && job.providerJobId) {
    await db
      .update(generationJobs)
      .set({ pollCount: job.pollCount + 1, lastPolledAt: new Date() })
      .where(eq(generationJobs.id, job.id));
    let progress: LipsyncProgress;
    try {
      progress = await provider.poll(job.providerJobId);
    } catch (error) {
      progress = error instanceof ProviderRefusedError ? { status: "failed", error: message(error) } : { status: "running" };
    }
    current = await applyProgress(input.workspaceId, { ...job, pollCount: job.pollCount + 1 }, provider, progress);
  }
  return talkingClip(current, audio, provider);
}

/** Polls every `lipsync` job whose `next_poll_at` has passed. For the cron tick. Returns how many were polled. */
export async function pollDueVoiceJobs(now = new Date(), resolve?: VoiceResolvers): Promise<number> {
  const db = await getDb();
  const due = await db
    .select({ id: generationJobs.id, workspaceId: generationJobs.workspaceId })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.kind, "lipsync"),
        inArray(generationJobs.status, ["submitted", "running"]),
        lte(generationJobs.nextPollAt, now),
      ),
    )
    .limit(25);
  for (const job of due) await refreshLipsyncJob({ workspaceId: job.workspaceId, jobId: job.id, resolve });
  return due.length;
}
