import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
  auditLog,
  generationAttempts,
  generationJobs,
  sceneTakes,
  videoHooks,
  videoScenes,
  videos,
  workspaces,
} from "@/db/schema";
import { generateFromMessage, handleUserMessage, listChat } from "@/lib/agent/run";
import { chatTools } from "@/lib/agent/tools/registry";
import { isPlanMessage } from "@/lib/agent/plan";
import { signupAccount } from "@/lib/auth/account";
import { monthlySpendUsd } from "@/lib/budget";
import { resetMockRefusals } from "@/lib/providers/mock";
import { BudgetExceededError, generateVideo, parseManifest, stitch } from "@/lib/router";
import { takeCharge, type TakeJobRunner } from "./jobs";
import { completeTakeJob, latestEditableVideoId, regenerateScene } from "./regenerate";
import {
  captionsFromManifest,
  cleanCaption,
  composeManifest,
  EditorError,
  isEditableStatus,
  nextTakeNumber,
  sceneCaptionText,
  takePrompt,
  type EditorState,
} from "./state";
import { ensureEditor, loadEditor, saveCaptions, saveHooks, selectTake } from "./store";

const password = "correct-horse-battery";

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

beforeEach(() => {
  resetMockRefusals();
});

async function account(label = "editor") {
  return signupAccount({ email: email(label), password, workspaceName: `${label} Co` });
}

/** A mock-generated video from a chat plan, with hook option 2 used. */
async function plannedVideo(label = "editor") {
  const { user, workspace } = await account(label);
  await handleUserMessage({
    workspace,
    userId: user.id,
    text: "Make a 30s video about our oat-milk cold brew for busy commuters",
  });
  const planMessage = (await listChat(workspace.id)).find((message) => isPlanMessage(message.data));
  if (!planMessage || !isPlanMessage(planMessage.data)) throw new Error("no plan");
  const result = await generateFromMessage({
    workspaceId: workspace.id,
    userId: user.id,
    messageId: planMessage.id,
    tier: "standard",
    hookIndex: 1,
  });
  if (!result.ok) throw new Error(result.error);
  return { user, workspace, videoId: result.videoId, plan: planMessage.data.plan };
}

async function videoRow(videoId: string) {
  const db = await getDb();
  const [row] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!row) throw new Error("missing video");
  return row;
}

describe("editor rules", () => {
  const manifest = stitch({
    hook: "Hook A",
    scenes: [
      { visual: "v1", line: "One", durationS: 10, model: "omni-flash", frameUrl: "data:image/svg+xml,a" },
      { visual: "v2", line: "Two", durationS: 10, model: "omni-flash", frameUrl: "data:image/svg+xml,b" },
    ],
  });

  it("maps caption cues onto scene windows", () => {
    expect(captionsFromManifest(manifest)).toEqual([
      { sceneIndex: 0, startMs: 0, endMs: 10000, text: "One" },
      { sceneIndex: 1, startMs: 10000, endMs: 20000, text: "Two" },
    ]);
    expect(sceneCaptionText(manifest, 1)).toBe("Two");
    expect(sceneCaptionText({ ...manifest, captions: [] }, 1)).toBe("Two");
    expect(sceneCaptionText(manifest, 5)).toBe("");
  });

  it("composes a manifest from the selected takes, captions and hook, keeping other keys", () => {
    const state: Pick<EditorState, "scenes" | "captions" | "hooks"> = {
      scenes: [
        {
          id: "s2",
          position: 1,
          visual: "v2",
          line: "Two",
          durationMs: 10000,
          selectedTakeId: "t3",
          takes: [
            { id: "t3", number: 2, status: "ready", provider: "veo", model: "veo", frameUrl: "data:new", costUsd: 1, error: null },
          ],
        },
        { id: "s1", position: 0, visual: "v1", line: "One", durationMs: 10000, selectedTakeId: null, takes: [] },
      ],
      captions: [
        { id: "c2", sceneId: "s2", position: 1, startMs: 10000, endMs: 20000, text: "Edited two", source: "user" },
        { id: "c1", sceneId: "s1", position: 0, startMs: 0, endMs: 10000, text: "One", source: "ai" },
      ],
      hooks: [
        { id: "h1", position: 0, text: "Hook A", source: "ai", isSelected: false },
        { id: "h2", position: 1, text: "Hook B", source: "user", isSelected: true },
      ],
    };
    const next = composeManifest({ ...manifest, aiGenerated: false, extra: 1 }, state);
    expect(next.hook).toBe("Hook B");
    expect(next.aiGenerated).toBe(false);
    expect(next.extra).toBe(1);
    expect(next.scenes.map((scene) => [scene.frameUrl, scene.model])).toEqual([
      ["data:image/svg+xml,a", "omni-flash"],
      ["data:new", "veo"],
    ]);
    expect(next.captions.map((cue) => cue.text)).toEqual(["One", "Edited two"]);
    expect(next.totalDurationS).toBe(20);
  });

  it("validates text and numbers takes", () => {
    expect(nextTakeNumber([])).toBe(1);
    expect(nextTakeNumber([{ number: 1 }, { number: 4 }])).toBe(5);
    expect(cleanCaption("  hello   there ")).toBe("hello there");
    expect(() => cleanCaption("   ")).toThrow(EditorError);
    expect(() => cleanCaption("x".repeat(201))).toThrow(/200/);
    expect(takePrompt({ videoPrompt: "Make it", visual: "Kitchen", direction: "  closer  " })).toBe(
      "Make it\nKitchen\nDirection: closer",
    );
    expect(isEditableStatus("ready")).toBe(true);
    expect(isEditableStatus("approved")).toBe(false);
    expect(takeCharge("omni-flash", 10)).toBeGreaterThan(0);
  });
});

describe("editor store", () => {
  it("seeds scenes with take 1 selected, captions, and the plan's hooks on first open, once", async () => {
    const { workspace, videoId, plan } = await plannedVideo("seed");
    const state = await loadEditor(workspace.id, videoId);
    expect(state?.editable).toBe(true);
    expect(state?.scenes).toHaveLength(3);
    for (const scene of state?.scenes ?? []) {
      expect(scene.takes).toHaveLength(1);
      expect(scene.selectedTakeId).toBe(scene.takes[0]?.id);
      expect(scene.takes[0]?.frameUrl).toMatch(/^data:image\/svg\+xml/);
    }
    expect(state?.captions.map((cue) => cue.text)).toEqual(plan.scenes.map((scene) => scene.line));
    expect(state?.hooks.map((hook) => hook.text)).toEqual(plan.hooks);
    expect(state?.hooks.find((hook) => hook.isSelected)?.text).toBe(plan.hooks[1]);

    await ensureEditor(await videoRow(videoId));
    const again = await loadEditor(workspace.id, videoId);
    expect(again?.scenes).toHaveLength(3);
    expect(again?.captions).toHaveLength(3);
    expect(again?.hooks).toHaveLength(3);
  });

  it("keeps other workspaces out", async () => {
    const { videoId } = await plannedVideo("owner");
    const { user, workspace } = await account("intruder");
    expect(await loadEditor(workspace.id, videoId)).toBeNull();
    await expect(
      saveCaptions({ workspaceId: workspace.id, videoId, actor: user.id, edits: [] }),
    ).rejects.toThrow("Video not found");
  });

  it("saves edited captions as user cues and shows them in the manifest", async () => {
    const { user, workspace, videoId } = await plannedVideo("captions");
    const state = await loadEditor(workspace.id, videoId);
    const cue = state?.captions[1];
    if (!cue) throw new Error("no cue");
    const changed = await saveCaptions({
      workspaceId: workspace.id,
      videoId,
      actor: user.id,
      edits: [
        { id: cue.id, text: "  Cold brew, but  calmer. " },
        { id: state!.captions[0]!.id, text: state!.captions[0]!.text },
      ],
    });
    expect(changed).toBe(1);
    const after = await loadEditor(workspace.id, videoId);
    expect(after?.captions[1]).toMatchObject({ text: "Cold brew, but calmer.", source: "user" });
    const manifest = parseManifest((await videoRow(videoId)).manifest);
    expect(manifest?.captions[1]?.text).toBe("Cold brew, but calmer.");
    expect(sceneCaptionText(manifest!, 1)).toBe("Cold brew, but calmer.");

    await expect(
      saveCaptions({ workspaceId: workspace.id, videoId, actor: user.id, edits: [{ id: cue.id, text: " " }] }),
    ).rejects.toThrow("A caption cannot be empty.");
  });

  it("edits, adds and selects hooks with one selected per video", async () => {
    const { user, workspace, videoId } = await plannedVideo("hooks");
    const state = await loadEditor(workspace.id, videoId);
    const [first] = state?.hooks ?? [];
    if (!first) throw new Error("no hook");

    await saveHooks({
      workspaceId: workspace.id,
      videoId,
      actor: user.id,
      edits: [{ id: first.id, text: "Commute, upgraded" }],
      selected: first.id,
    });
    expect(parseManifest((await videoRow(videoId)).manifest)?.hook).toBe("Commute, upgraded");

    await saveHooks({
      workspaceId: workspace.id,
      videoId,
      actor: user.id,
      edits: [],
      added: "Your 7am just got easier",
      selected: "new",
    });
    const after = await loadEditor(workspace.id, videoId);
    expect(after?.hooks).toHaveLength(4);
    expect(after?.hooks.filter((hook) => hook.isSelected).map((hook) => hook.text)).toEqual(["Your 7am just got easier"]);
    expect(after?.hooks[3]?.source).toBe("user");
    expect(parseManifest((await videoRow(videoId)).manifest)?.hook).toBe("Your 7am just got easier");

    await expect(
      saveHooks({ workspaceId: workspace.id, videoId, actor: user.id, edits: [], selected: "new" }),
    ).rejects.toThrow("Pick the hook to use.");
  });

  it("locks editing once the video is approved", async () => {
    const { user, workspace, videoId } = await plannedVideo("locked");
    const state = await loadEditor(workspace.id, videoId);
    const db = await getDb();
    await db.update(videos).set({ status: "approved" }).where(eq(videos.id, videoId));
    expect((await loadEditor(workspace.id, videoId))?.editable).toBe(false);
    await expect(
      selectTake({ workspaceId: workspace.id, videoId, takeId: state!.scenes[0]!.takes[0]!.id, actor: user.id }),
    ).rejects.toThrow(/locked/);
    await expect(
      regenerateScene({ workspace, videoId, sceneNumber: 1, actor: user.id }),
    ).rejects.toBeInstanceOf(EditorError);
    expect(await latestEditableVideoId(workspace.id)).toBeNull();
  });
});

describe("regenerateScene", () => {
  it("adds a selected take for one scene, charges only that clip, and leaves the others alone", async () => {
    const { user, workspace, videoId } = await plannedVideo("regen");
    const before = await loadEditor(workspace.id, videoId);
    const beforeVideo = await videoRow(videoId);
    const spentBefore = await monthlySpendUsd(workspace.id, workspace.timezone);

    const result = await regenerateScene({ workspace, videoId, sceneNumber: 2, actor: user.id, direction: "closer" });
    expect(result).toMatchObject({ status: "ready", sceneNumber: 2, takeNumber: 2 });
    if (result.status !== "ready") return;
    expect(result.costUsd).toBe(takeCharge(result.model, 10));

    const after = await loadEditor(workspace.id, videoId);
    const scene2 = after?.scenes[1];
    expect(scene2?.takes.map((take) => take.number)).toEqual([1, 2]);
    expect(scene2?.selectedTakeId).toBe(scene2?.takes[1]?.id);
    expect(after?.scenes[0]?.selectedTakeId).toBe(before?.scenes[0]?.selectedTakeId);
    expect(after?.scenes[2]?.selectedTakeId).toBe(before?.scenes[2]?.selectedTakeId);
    expect(after?.scenes[0]?.takes).toHaveLength(1);

    const db = await getDb();
    const [take] = await db.select().from(sceneTakes).where(eq(sceneTakes.id, scene2!.takes[1]!.id));
    expect(take?.prompt).toMatch(/Direction: closer$/);
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, take!.jobId!));
    expect(job).toMatchObject({ kind: "clip", status: "succeeded", videoId, model: result.model });
    expect(job?.outputAssetId).toBe(take?.posterAssetId);

    const afterVideo = await videoRow(videoId);
    expect(Number(afterVideo.costActualUsd)).toBeCloseTo(Number(beforeVideo.costActualUsd) + result.costUsd, 2);
    expect(await monthlySpendUsd(workspace.id, workspace.timezone)).toBeCloseTo(spentBefore + result.costUsd, 2);
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.workspaceId, workspace.id), eq(auditLog.action, "video.scene_regenerated")));
    expect(audit).toHaveLength(1);

    // Switch back to take 1; the choice is stored on the scene.
    await selectTake({ workspaceId: workspace.id, videoId, takeId: scene2!.takes[0]!.id, actor: user.id });
    const [stored] = await db.select().from(videoScenes).where(eq(videoScenes.id, scene2!.id));
    expect(stored?.selectedTakeId).toBe(scene2!.takes[0]!.id);
    expect(parseManifest((await videoRow(videoId)).manifest)?.scenes[1]?.frameUrl).toBe(scene2!.takes[0]!.frameUrl);
  });

  it("falls back along the tier chain on a refusal and charges nothing when every model refuses", async () => {
    const { user, workspace, videoId } = await plannedVideo("refuse");
    const db = await getDb();
    await db.update(videos).set({ prompt: "cold brew [refuse]" }).where(eq(videos.id, videoId));

    const fallback = await regenerateScene({ workspace, videoId, sceneNumber: 1, actor: user.id });
    expect(fallback.status).toBe("ready");
    const attempts = await db.select().from(generationAttempts).where(eq(generationAttempts.videoId, videoId));
    const regenAttempts = attempts.filter((row) => row.detail?.takeNumber === 2);
    expect(regenAttempts.map((row) => row.status)).toEqual(["refused", "ok"]);
    expect(Number(regenAttempts[0]?.costUsd)).toBe(0);

    await db.update(videos).set({ prompt: "cold brew [refuse-all]" }).where(eq(videos.id, videoId));
    const costBefore = Number((await videoRow(videoId)).costActualUsd);
    const spentBefore = await monthlySpendUsd(workspace.id, workspace.timezone);
    const failed = await regenerateScene({ workspace, videoId, sceneNumber: 1, actor: user.id });
    expect(failed).toMatchObject({ status: "failed", takeNumber: 3 });
    const state = await loadEditor(workspace.id, videoId);
    const scene1 = state?.scenes[0];
    expect(scene1?.takes[2]).toMatchObject({ status: "failed", costUsd: 0 });
    expect(scene1?.selectedTakeId).toBe(scene1?.takes[1]?.id);
    expect(Number((await videoRow(videoId)).costActualUsd)).toBe(costBefore);
    expect(await monthlySpendUsd(workspace.id, workspace.timezone)).toBe(spentBefore);
    const [job] = await db
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.videoId, videoId), eq(generationJobs.status, "refused")));
    expect(job?.kind).toBe("clip");
  });

  it("refuses to start when the monthly budget cannot cover the clip", async () => {
    const { user, workspace, videoId } = await plannedVideo("budget");
    const db = await getDb();
    const spent = await monthlySpendUsd(workspace.id, workspace.timezone);
    await db.update(workspaces).set({ budgetCapUsd: spent }).where(eq(workspaces.id, workspace.id));
    const [capped] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
    await expect(regenerateScene({ workspace: capped!, videoId, sceneNumber: 1, actor: user.id })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect((await loadEditor(workspace.id, videoId))?.scenes[0]?.takes).toHaveLength(1);
  });

  it("plugs into a submit-and-poll job runner through completeTakeJob", async () => {
    const { user, workspace, videoId } = await plannedVideo("jobs");
    const db = await getDb();
    let submittedJobId = "";
    const submitter: TakeJobRunner = {
      async run(input) {
        const [job] = await db
          .insert(generationJobs)
          .values({
            workspaceId: input.workspaceId,
            videoId: input.videoId,
            kind: "clip",
            provider: "veo-3.1-lite",
            providerJobId: `op-${input.takeId}`,
            status: "submitted",
          })
          .returning({ id: generationJobs.id });
        submittedJobId = job!.id;
        return { status: "submitted", jobId: job!.id, attempts: [] };
      },
    };
    const started = await regenerateScene({ workspace, videoId, sceneNumber: 3, actor: user.id, runner: submitter });
    expect(started).toMatchObject({ status: "generating", takeNumber: 2 });
    await expect(
      regenerateScene({ workspace, videoId, sceneNumber: 3, actor: user.id, runner: submitter }),
    ).rejects.toThrow("Scene 3 is already regenerating.");

    const done = await completeTakeJob({
      jobId: submittedJobId,
      ok: true,
      model: "veo-3.1-lite",
      frameAssetId: null,
      clipAssetId: null,
      costUsd: 0.5,
      attempts: [{ sceneIndex: 2, step: 0, provider: "veo-3.1-lite", status: "ok" }],
    });
    expect(done).toBe(true);
    const scene3 = (await loadEditor(workspace.id, videoId))?.scenes[2];
    expect(scene3?.takes[1]).toMatchObject({ status: "ready", model: "veo-3.1-lite", costUsd: 0.5 });
    expect(scene3?.selectedTakeId).toBe(scene3?.takes[1]?.id);
    expect(await completeTakeJob({ jobId: submittedJobId, ok: false, error: "late", attempts: [] })).toBe(false);
  });
});

describe("regenerate-scene chat tool", () => {
  it("parses the request without a model", () => {
    expect(chatTools.match("regenerate scene 2")).toMatchObject({ tool: { name: "regenerate-scene" }, args: { scene: 2 } });
    expect(chatTools.match("Please redo scene 1: brighter kitchen.")?.args).toEqual({ scene: 1, direction: "brighter kitchen" });
    expect(chatTools.match("regenerate scene 0")).toBeNull();
    const definition = chatTools.definitions().find((item) => item.name === "regenerate-scene");
    expect(definition?.inputSchema).toMatchObject({ type: "object", required: ["scene"] });
  });

  it("regenerates a scene of the latest editable video from chat", async () => {
    const { user, workspace } = await account("tool-empty");
    await handleUserMessage({ workspace, userId: user.id, text: "regenerate scene 2" });
    expect((await listChat(workspace.id)).at(-1)?.content).toMatch(/no finished, unapproved video/);

    const made = await plannedVideo("tool");
    await handleUserMessage({ workspace: made.workspace, userId: made.user.id, text: "regenerate scene 2" });
    expect((await listChat(made.workspace.id)).at(-1)?.content).toMatch(/^Scene 2 has a new take \(take 2, \$/);
    await handleUserMessage({ workspace: made.workspace, userId: made.user.id, text: "regenerate scene 9" });
    expect((await listChat(made.workspace.id)).at(-1)?.content).toBe("This video has no scene 9.");
  });

  it("seeds from a video generated outside chat with just its own hook", async () => {
    const { workspace } = await account("direct");
    const result = await generateVideo({
      workspaceId: workspace.id,
      tier: "budget",
      title: "Direct",
      prompt: "direct",
      hook: "Only hook",
      voiceLines: ["a", "b"],
      scenes: [
        { visual: "a", line: "A", durationS: 5 },
        { visual: "b", line: "B", durationS: 5 },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    const state = await loadEditor(workspace.id, result.videoId);
    expect(state?.scenes).toHaveLength(2);
    const db = await getDb();
    const hooks = await db.select().from(videoHooks).where(eq(videoHooks.videoId, result.videoId));
    expect(hooks.map((hook) => [hook.text, hook.isSelected])).toEqual([["Only hook", true]]);
  });
});
