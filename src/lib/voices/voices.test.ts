import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLog, avatars, generationJobs, mediaAssets, voiceClones, voiceCloneSamples, voices } from "@/db/schema";
import { handleUserMessage, listChat } from "@/lib/agent/run";
import { signupAccount } from "@/lib/auth/account";
import { saveStockAvatar } from "@/lib/avatars/store";
import { registry } from "@/lib/providers/registry";
import { ProviderUnavailableError } from "@/lib/providers/types";
import { ConsentRequiredError, listClones, revokeClone, startCloneDraft, submitClone } from "./clone";
import { STOCK_VOICE_CATALOG } from "./catalog";
import { lipsyncLine, pollDueVoiceJobs, refreshLipsyncJob, speakLine } from "./pipeline";
import { previewAudio } from "./preview";
import { getVoice, listVoices, resolveAvatarVoice, setAvatarVoice, VoiceError } from "./store";
import type { AudioFile, LipsyncProgress, LipsyncProvider, VoiceProvider } from "./types";
import { synthWav } from "./wav";

async function account(label: string) {
  const { user, workspace } = await signupAccount({
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password: "correct-horse-battery",
    workspaceName: `${label} Co`,
  });
  const avatar = await saveStockAvatar({ workspaceId: workspace.id, actorUserId: user.id, avatarId: "mina-cole" });
  return { user, workspace, avatar };
}

function sample(text = "This is my real voice reading a sentence for the clone."): AudioFile {
  return { bytes: synthWav(text).bytes, mimeType: "application/octet-stream", filename: "me.wav" };
}

async function jobsOf(workspaceId: string, kind: "voice" | "voice_clone" | "lipsync") {
  const db = await getDb();
  return db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.workspaceId, workspaceId), eq(generationJobs.kind, kind)));
}

/** A lip-sync vendor stand-in that stays running until told to finish. */
function slowLipsync(): LipsyncProvider & { next: LipsyncProgress } {
  const provider = {
    id: "heygen-avatar-iv",
    vendor: "heygen",
    label: "Slow engine",
    usdPerSecond: 0.05,
    maxDurationS: 60,
    next: { status: "running" } as LipsyncProgress,
    isLive: () => true,
    submit: async () => ({ providerJobId: `slow_${crypto.randomUUID()}`, status: "running" as const }),
    poll: async () => provider.next,
  };
  return provider;
}

describe("voice catalog", () => {
  it("seeds the eight stock voices once and maps legacy avatar voice labels to them", async () => {
    const { workspace, avatar } = await account("catalog");
    const first = await listVoices(workspace.id);
    const second = await listVoices(workspace.id);
    expect(first.map((voice) => voice.name)).toEqual(STOCK_VOICE_CATALOG.map((voice) => voice.name));
    expect(second.map((voice) => voice.id)).toEqual(first.map((voice) => voice.id));
    expect(first.every((voice) => voice.kind === "stock" && voice.workspaceId === null)).toBe(true);
    expect((await resolveAvatarVoice(workspace.id, avatar)).name).toBe("Warm alto");
  });

  it("registers the ElevenLabs voice models and the HeyGen lip-sync engine", () => {
    expect(registry.list("voice").map((provider) => provider.id)).toEqual(["elevenlabs-v3", "elevenlabs-flash"]);
    expect(registry.list("lipsync").map((provider) => provider.id)).toEqual(["heygen-avatar-iv"]);
    expect(registry.get("voice", "elevenlabs-v3").isLive()).toBe(false);
  });

  it("sets a voice per avatar, audits it, and rejects other workspaces' avatars", async () => {
    const owner = await account("choose");
    const other = await account("choose-other");
    const voicesList = await listVoices(owner.workspace.id);
    const baritone = voicesList.find((voice) => voice.name === "Steady baritone")!;
    await setAvatarVoice({
      workspaceId: owner.workspace.id,
      actorUserId: owner.user.id,
      avatarId: owner.avatar.id,
      voiceId: baritone.id,
      lipsyncModel: "heygen-avatar-iv",
    });
    const db = await getDb();
    const [saved] = await db.select().from(avatars).where(eq(avatars.id, owner.avatar.id));
    expect(saved?.ttsVoiceId).toBe(baritone.id);
    expect(saved?.lipsyncModel).toBe("heygen-avatar-iv");
    expect((await resolveAvatarVoice(owner.workspace.id, saved!)).name).toBe("Steady baritone");
    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, owner.workspace.id));
    expect(audits.map((row) => row.action)).toContain("avatar.voice_selected");

    await expect(
      setAvatarVoice({ workspaceId: other.workspace.id, actorUserId: other.user.id, avatarId: owner.avatar.id, voiceId: baritone.id }),
    ).rejects.toThrow("Unknown avatar");
    await expect(
      setAvatarVoice({
        workspaceId: owner.workspace.id,
        actorUserId: owner.user.id,
        avatarId: owner.avatar.id,
        voiceId: baritone.id,
        lipsyncModel: "nope",
      }),
    ).rejects.toThrow("Unknown lip-sync engine");
  });

  it("previews a voice with mock audio when there is no key, without spending", async () => {
    const { workspace } = await account("preview");
    const [voice] = await listVoices(workspace.id);
    const preview = await previewAudio(voice!);
    expect(preview && "bytes" in preview && preview.mimeType).toBe("audio/wav");
    expect(await jobsOf(workspace.id, "voice")).toHaveLength(0);
  });
});

describe("speech and lip-sync pipeline", () => {
  it("speaks a line in the avatar's voice and stores the audio and a voice job", async () => {
    const { workspace, avatar } = await account("speak");
    const track = await speakLine({ workspaceId: workspace.id, avatarId: avatar.id, text: "Cold brew, ready when you are." });
    expect(track).toMatchObject({ voiceName: "Warm alto", providerId: "elevenlabs-v3", mimeType: "audio/wav", mock: true });
    expect(track.url.startsWith("data:audio/wav;base64,")).toBe(true);
    expect(track.durationMs).toBeGreaterThan(500);
    expect(track.costUsd).toBeCloseTo((0.1 * 30) / 1000, 4);
    const [job] = await jobsOf(workspace.id, "voice");
    expect(job).toMatchObject({ status: "succeeded", outputAssetId: track.assetId, provider: "elevenlabs-v3" });
    const db = await getDb();
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, track.assetId));
    expect(asset).toMatchObject({ kind: "audio", source: "generated", storage: "inline", durationMs: track.durationMs });
  });

  it("records a refused voice job at zero cost and rethrows", async () => {
    const { workspace, avatar } = await account("refuse");
    await expect(speakLine({ workspaceId: workspace.id, avatarId: avatar.id, text: "[refuse-all] nope" })).rejects.toThrow(
      /refused/,
    );
    const [job] = await jobsOf(workspace.id, "voice");
    expect(job).toMatchObject({ status: "refused", costUsd: 0, outputAssetId: null });
  });

  it("makes a mock talking clip at once and persists the lip-sync job", async () => {
    const { workspace, avatar } = await account("lipsync");
    const clip = await lipsyncLine({ workspaceId: workspace.id, avatarId: avatar.id, text: "Hi, I'm Mina." });
    expect(clip).toMatchObject({ status: "succeeded", providerId: "heygen-avatar-iv", mimeType: "image/svg+xml", mock: true });
    expect(decodeURIComponent(clip.url!)).toContain('data-mock-lipsync="true"');
    expect(clip.audio.mimeType).toBe("audio/wav");
    const [job] = await jobsOf(workspace.id, "lipsync");
    expect(job).toMatchObject({ status: "succeeded", outputAssetId: clip.assetId });
    expect(job?.providerJobId).toMatch(/^mock_/);
    expect(job?.request).toMatchObject({ avatarId: avatar.id, audioJobId: clip.audio.jobId });
    expect(Number(job?.costUsd)).toBeGreaterThan(0);
  });

  it("polls a vendor job until it finishes, then stores the clip", async () => {
    const { workspace, avatar } = await account("poll");
    const engine = slowLipsync();
    const resolve = { lipsync: () => engine };
    const running = await lipsyncLine({ workspaceId: workspace.id, avatarId: avatar.id, text: "Still going.", resolve });
    expect(running).toMatchObject({ status: "running", url: null, costUsd: 0 });

    const still = await refreshLipsyncJob({ workspaceId: workspace.id, jobId: running.jobId, resolve });
    expect(still?.status).toBe("running");

    engine.next = {
      status: "succeeded",
      output: { url: "https://cdn.example.com/talk.mp4", mimeType: "video/mp4", durationMs: 2000, posterUrl: null },
    };
    expect(await pollDueVoiceJobs(new Date(Date.now() + 60_000), resolve)).toBeGreaterThanOrEqual(1);
    const done = await refreshLipsyncJob({ workspaceId: workspace.id, jobId: running.jobId, resolve });
    expect(done).toMatchObject({ status: "succeeded", url: "https://cdn.example.com/talk.mp4", mimeType: "video/mp4" });
    expect(done?.costUsd).toBeCloseTo(0.1, 4);
    const [job] = await jobsOf(workspace.id, "lipsync");
    expect(job?.pollCount).toBeGreaterThanOrEqual(2);
    const db = await getDb();
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, job!.outputAssetId!));
    expect(asset).toMatchObject({ storage: "external", kind: "video" });
  });

  it("times out a job past its deadline and charges nothing", async () => {
    const { workspace, avatar } = await account("timeout");
    const engine = slowLipsync();
    const resolve = { lipsync: () => engine };
    const running = await lipsyncLine({ workspaceId: workspace.id, avatarId: avatar.id, text: "Too slow.", resolve });
    const db = await getDb();
    await db.update(generationJobs).set({ deadlineAt: new Date(Date.now() - 1000) }).where(eq(generationJobs.id, running.jobId));
    const timedOut = await refreshLipsyncJob({ workspaceId: workspace.id, jobId: running.jobId, resolve });
    expect(timedOut).toMatchObject({ status: "failed", costUsd: 0 });
    const [job] = await jobsOf(workspace.id, "lipsync");
    expect(job?.status).toBe("timed_out");
  });

  it("fails a lip-sync job at submit with zero cost", async () => {
    const { workspace, avatar } = await account("lipsync-fail");
    const engine = { ...slowLipsync(), submit: () => Promise.reject(new ProviderUnavailableError("heygen-avatar-iv", "down")) };
    await expect(
      lipsyncLine({ workspaceId: workspace.id, avatarId: avatar.id, text: "Hello.", resolve: { lipsync: () => engine } }),
    ).rejects.toThrow("down");
    const [job] = await jobsOf(workspace.id, "lipsync");
    expect(job).toMatchObject({ status: "failed", costUsd: 0 });
  });
});

describe("voice cloning", () => {
  it("refuses to clone without consent and writes nothing", async () => {
    const { workspace, user } = await account("no-consent");
    await expect(
      submitClone({
        workspaceId: workspace.id,
        actorUserId: user.id,
        name: "Me",
        speakerName: "Dana",
        basis: "self",
        consent: false,
        samples: [sample()],
      }),
    ).rejects.toThrow(ConsentRequiredError);
    expect(await listClones(workspace.id)).toHaveLength(0);
    expect(await jobsOf(workspace.id, "voice_clone")).toHaveLength(0);
  });

  it("rejects files that are not audio", async () => {
    const { workspace, user } = await account("bad-sample");
    const notAudio: AudioFile = { bytes: new Uint8Array(4096).fill(65), mimeType: "audio/wav", filename: "fake.wav" };
    await expect(
      submitClone({
        workspaceId: workspace.id,
        actorUserId: user.id,
        name: "Me",
        speakerName: "Dana",
        basis: "self",
        consent: true,
        samples: [notAudio],
      }),
    ).rejects.toThrow(VoiceError);
  });

  it("clones from a chat draft with recorded consent, then the clone can voice an avatar and be revoked", async () => {
    const { workspace, user, avatar } = await account("clone");
    const other = await account("clone-other");
    const draft = await startCloneDraft({ workspaceId: workspace.id, actorUserId: user.id, name: "Dana's voice" });
    expect(draft.status).toBe("awaiting_consent");

    const { clone, voice } = await submitClone({
      workspaceId: workspace.id,
      actorUserId: user.id,
      cloneId: draft.id,
      name: "Dana's voice",
      speakerName: "Dana",
      basis: "self",
      consent: true,
      samples: [sample()],
    });
    expect(clone).toMatchObject({ id: draft.id, status: "ready", consentedBy: user.id, provider: "mock" });
    expect(clone.consentStatement).toMatch(/my own \(Dana\)/);
    expect(clone.consentedAt).toBeInstanceOf(Date);
    expect(voice).toMatchObject({ kind: "clone", workspaceId: workspace.id, provider: "mock" });

    const db = await getDb();
    const samples = await db.select().from(voiceCloneSamples).where(eq(voiceCloneSamples.cloneId, clone.id));
    expect(samples).toHaveLength(1);
    const [stored] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, samples[0]!.assetId));
    expect(stored).toMatchObject({ kind: "audio", source: "upload", mimeType: "audio/wav" });
    expect((await jobsOf(workspace.id, "voice_clone"))[0]?.status).toBe("succeeded");

    expect((await listVoices(workspace.id)).map((row) => row.name)).toContain("Dana's voice");
    expect(await getVoice(other.workspace.id, voice!.id)).toBeNull();
    expect((await listVoices(other.workspace.id)).map((row) => row.name)).not.toContain("Dana's voice");

    await setAvatarVoice({ workspaceId: workspace.id, actorUserId: user.id, avatarId: avatar.id, voiceId: voice!.id });
    const track = await speakLine({ workspaceId: workspace.id, avatarId: avatar.id, text: "My own voice." });
    expect(track.voiceName).toBe("Dana's voice");

    const revoked = await revokeClone({ workspaceId: workspace.id, actorUserId: user.id, cloneId: clone.id });
    expect(revoked.status).toBe("revoked");
    const [after] = await db.select().from(avatars).where(eq(avatars.id, avatar.id));
    expect(after?.ttsVoiceId).toBeNull();
    const [archived] = await db.select().from(voices).where(eq(voices.id, voice!.id));
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect((await listVoices(workspace.id)).map((row) => row.name)).not.toContain("Dana's voice");
    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspace.id));
    expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining(["voice_clone.consented", "voice_clone.revoked"]));
  });

  it("marks the clone failed with no voice when the provider fails", async () => {
    const { workspace, user } = await account("clone-fail");
    const failing = {
      ...registry.get("voice", "elevenlabs-v3"),
      cloneVoice: () => Promise.reject(new ProviderUnavailableError("elevenlabs-v3", "quota exceeded")),
    } satisfies VoiceProvider;
    const { clone, voice } = await submitClone({
      workspaceId: workspace.id,
      actorUserId: user.id,
      name: "Sam",
      speakerName: "Sam Lee",
      basis: "permission",
      consent: true,
      samples: [sample()],
      resolve: () => failing,
    });
    expect(voice).toBeNull();
    expect(clone).toMatchObject({ status: "failed", error: "quota exceeded" });
    expect(clone.consentStatement).toMatch(/Sam Lee’s explicit permission/);
    const db = await getDb();
    const [row] = await db.select().from(voiceClones).where(eq(voiceClones.id, clone.id));
    expect(row?.voiceId).toBeNull();
    expect((await jobsOf(workspace.id, "voice_clone"))[0]).toMatchObject({ status: "failed", costUsd: 0 });
  });
});

describe("voice chat tools", () => {
  it("lists voices, sets the default avatar's voice, and starts a consent-gated clone", async () => {
    const { workspace, user, avatar } = await account("chat-voices");
    const say = (text: string) => handleUserMessage({ workspace, userId: user.id, text });

    await say("list voices");
    let messages = await listChat(workspace.id);
    expect(messages.at(-1)?.content).toMatch(/^Voices you can use:\nWarm alto/);

    await say("use the steady baritone voice");
    messages = await listChat(workspace.id);
    expect(messages.at(-1)?.content).toBe("Mina Cole now speaks with Steady baritone. Preview it on the Avatars page.");
    const db = await getDb();
    const [saved] = await db.select().from(avatars).where(eq(avatars.id, avatar.id));
    expect((await getVoice(workspace.id, saved!.ttsVoiceId!))?.name).toBe("Steady baritone");

    await say("use the opera voice");
    messages = await listChat(workspace.id);
    expect(messages.at(-1)?.content).toMatch(/couldn’t find a voice called “opera”/);

    await say("clone my voice");
    messages = await listChat(workspace.id);
    expect(messages.at(-1)?.content).toMatch(/Nothing is sent to a voice provider until you confirm/);
    const clones = await listClones(workspace.id);
    expect(clones).toHaveLength(1);
    expect(clones[0]).toMatchObject({ name: "My voice", status: "awaiting_consent", consentedAt: null });
    expect(await jobsOf(workspace.id, "voice_clone")).toHaveLength(0);
  });
});
