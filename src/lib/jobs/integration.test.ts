import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { chatMessages, generationJobs, sceneTakes, videos } from "@/db/schema";
import { isPlanMessage } from "@/lib/agent/plan";
import { generateFromMessage, handleUserMessage, listChat } from "@/lib/agent/run";
import { signupAccount } from "@/lib/auth/account";
import { regenerateScene } from "@/lib/editor/regenerate";
import { loadEditor } from "@/lib/editor/store";
import { resetMockRefusals } from "@/lib/providers/mock";
import { renderInputFor } from "./render";
import { processJobs } from "./worker";

beforeEach(() => resetMockRefusals());
afterEach(() => vi.unstubAllEnvs());

async function plannedMessage(label: string) {
  const { user, workspace } = await signupAccount({
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password: "correct-horse-battery",
    workspaceName: `${label} Co`,
  });
  const turn = await handleUserMessage({
    workspace,
    userId: user.id,
    text: "Make a 30s video about our oat-milk cold brew for busy commuters",
  });
  const planMessage = (await listChat(workspace.id)).find((message) => isPlanMessage(message.data));
  if (!turn || !planMessage) throw new Error("no plan");
  return { user, workspace, conversationId: turn.conversationId, planMessage };
}

/** Worker passes with a clock that jumps ahead, as cron ticks would. */
async function drain(videoId: string) {
  const db = await getDb();
  let now = Date.now();
  for (let pass = 0; pass < 40; pass += 1) {
    await processJobs({ videoId, now: new Date(now) });
    const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
    if (video?.status !== "generating") return video;
    now += 61_000;
  }
  throw new Error("video did not settle");
}

describe("chat agent x video jobs", () => {
  it("posts the still-generating note and the later ready message into the plan's conversation", async () => {
    vi.stubEnv("VIDEO_INLINE_WAIT_MS", "0");
    const { user, workspace, conversationId, planMessage } = await plannedMessage("pending-chat");
    const result = await generateFromMessage({
      workspaceId: workspace.id,
      userId: user.id,
      messageId: planMessage.id,
      tier: "standard",
      hookIndex: 0,
    });
    if (!result.ok) throw new Error(result.error);
    const db = await getDb();
    const assistant = () =>
      db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.workspaceId, workspace.id), eq(chatMessages.role, "assistant")))
        .orderBy(asc(chatMessages.createdAt));
    const [note] = (await assistant()).filter((message) => /still generating/.test(message.content));
    expect(note?.conversationId).toBe(conversationId);

    expect((await drain(result.videoId))?.status).toBe("ready");
    const ready = (await assistant()).filter((message) => message.data?.kind === "ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ conversationId, userId: user.id });
    expect(ready[0]?.data?.videoId).toBe(result.videoId);
  });
});

describe("editor x render", () => {
  it("renders the selected takes, including a regenerated one, and queues a re-render after the change", async () => {
    const { user, workspace, planMessage } = await plannedMessage("editor-render");
    const result = await generateFromMessage({
      workspaceId: workspace.id,
      userId: user.id,
      messageId: planMessage.id,
      tier: "standard",
      hookIndex: 0,
    });
    if (!result.ok) throw new Error(result.error);
    const before = await loadEditor(workspace.id, result.videoId);
    const db = await getDb();
    const firstTakes = await db.select().from(sceneTakes).where(eq(sceneTakes.number, 1));
    const seeded = firstTakes.filter((take) => before?.scenes.some((scene) => scene.selectedTakeId === take.id));
    expect(seeded.length).toBe(before?.scenes.length);
    expect(seeded.every((take) => take.clipAssetId)).toBe(true);

    const regen = await regenerateScene({ workspace, videoId: result.videoId, sceneNumber: 2, actor: user.id });
    expect(regen.status).toBe("ready");
    const after = await loadEditor(workspace.id, result.videoId);
    const [take] = await db.select().from(sceneTakes).where(eq(sceneTakes.id, after!.scenes[1]!.selectedTakeId!));
    expect(take?.number).toBe(2);
    expect(take?.clipAssetId).toBeTruthy();

    const input = await renderInputFor(result.videoId);
    expect(input.scenes[1]?.clipAssetId).toBe(take?.clipAssetId);
    expect(input.scenes[1]?.mock).toBe(true);
    const renders = await db
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.videoId, result.videoId), eq(generationJobs.kind, "render"), eq(generationJobs.status, "queued")));
    expect(renders).toHaveLength(1);
    expect(renders[0]?.request).toMatchObject({ reason: "edit" });
  });
});
