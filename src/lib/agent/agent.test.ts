import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { scheduleItems, videos } from "@/db/schema";
import { handleUserMessage, listChat } from "@/lib/agent/run";
import { parseIntent } from "@/lib/agent/parse";
import { buildPlan, isPlanMessage, planCost } from "@/lib/agent/plan";
import { signupAccount } from "@/lib/auth/account";
import { nextGoodSlot, tomorrowAt } from "@/lib/schedule";

const password = "correct-horse-battery";

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

describe("parseIntent", () => {
  it("reads make/create requests, schedule phrasing, and the queue question", () => {
    expect(parseIntent("Make a 30s video about our new oat-milk cold brew for busy commuters")).toEqual({
      type: "plan",
      count: 1,
      durationS: 30,
      topic: "our new oat-milk cold brew for busy commuters",
    });
    expect(parseIntent("create 2 15s videos about the launch")).toEqual({
      type: "plan",
      count: 2,
      durationS: 15,
      topic: "the launch",
    });
    expect(parseIntent("schedule it tomorrow at 9am")).toEqual({ type: "schedule", when: "tomorrow-9am" });
    expect(parseIntent("next good slot")).toEqual({ type: "schedule", when: "next-good-slot" });
    expect(parseIntent("what's scheduled?")).toEqual({ type: "list-schedule" });
  });
});

describe("buildPlan", () => {
  it("writes 3 scenes, 3 hooks, captions, and the standard cost", () => {
    const plan = buildPlan({
      topic: "our new oat-milk cold brew for busy commuters",
      count: 1,
      durationS: 30,
      sourcePrompt: "Make a 30s video about our new oat-milk cold brew for busy commuters",
      brief: {
        companyName: "Northwind Cold Brew",
        niche: "cold brew",
        audience: "busy commuters",
        products: ["oat-milk cold brew"],
        tone: "warm",
      },
      avatar: { id: "ava", name: "Ava", look: "short dark hair" },
    });
    expect(plan.scenes).toHaveLength(3);
    expect(plan.hooks).toHaveLength(3);
    expect(plan.captions.split("\n")).toHaveLength(3);
    expect(plan.topic).toBe("New oat-milk cold brew for busy commuters");
    expect(plan.title).toBe("New Oat-Milk Cold Brew for Busy Commuters");
    expect(plan.scenes[0]?.visual).toMatch(/Ava/);
    expect(plan.scenes[0]?.line).toMatch(/oat-milk cold brew/i);
    expect(plan.scenes[0]?.line.toLowerCase()).toMatch(/hey/);
    expect(plan.scenes[1]?.line.toLowerCase()).toMatch(/use|watch/);
    expect(plan.scenes[2]?.line.toLowerCase()).toMatch(/try/);
    for (const hook of plan.hooks) expect(hook.length).toBeLessThanOrEqual(60);
    expect(plan.tier).toBe("standard");
    expect(planCost(plan).total).toBe(3.32);
    expect(plan.durationS).toBe(30);
  });

  it("does not paste raw brief prefixes or the user prompt into the script", () => {
    const plan = buildPlan({
      topic: "Make a 30s video about our oat-milk cold brew for busy commuters",
      count: 1,
      durationS: 30,
      sourcePrompt: "Make a 30s video about our oat-milk cold brew for busy commuters",
      brief: {
        companyName: "Northwind Cold Brew",
        niche: "Cold brew coffee",
        audience: "Made for busy commuters and remote workers.",
        products: ["Oat-milk cold brew"],
        tone: "friendly",
      },
      avatar: { id: "mina", name: "Mina Cole", look: "calm half-smile.." },
    });
    const blob = JSON.stringify({ scenes: plan.scenes, hooks: plan.hooks, title: plan.title });
    expect(blob).not.toMatch(/Made for Made|for Cold brew coffee|half-smile\.\.|Make a 30s/i);
    expect(plan.hooks.every((hook) => hook.length <= 60)).toBe(true);
    expect(plan.title).toBe("Oat-Milk Cold Brew for Busy Commuters");
    expect(plan.scenes[0]?.line).toMatch(/Oat-milk cold brew/);
  });
});

describe("slots", () => {
  it("picks tomorrow at 9:00 and the next 9/12/18 slot", () => {
    const afternoon = new Date("2026-09-26T15:00:00Z");
    expect(tomorrowAt(afternoon, "UTC").toISOString()).toBe("2026-09-27T09:00:00.000Z");
    expect(nextGoodSlot(afternoon, "UTC").toISOString()).toBe("2026-09-26T18:00:00.000Z");
    expect(nextGoodSlot(new Date("2026-09-26T18:30:00Z"), "UTC").toISOString()).toBe(
      "2026-09-27T09:00:00.000Z",
    );
    expect(nextGoodSlot(new Date("2026-09-26T08:00:00Z"), "UTC").toISOString()).toBe(
      "2026-09-26T09:00:00.000Z",
    );
  });
});

describe("chat agent", () => {
  it("stores a plan and can schedule an approved video", async () => {
    const { user, workspace } = await signupAccount({
      email: email("agent"),
      password,
      workspaceName: "Agent Co",
    });
    await handleUserMessage({
      workspace,
      userId: user.id,
      text: "Make a 30s video about our new oat-milk cold brew for busy commuters",
    });
    const messages = await listChat(workspace.id);
    const planMessage = messages.find((message) => isPlanMessage(message.data));
    expect(planMessage).toBeTruthy();
    if (!planMessage || !isPlanMessage(planMessage.data)) return;
    expect(planMessage.data.plan.scenes).toHaveLength(3);
    expect(planCost(planMessage.data.plan).total).toBe(3.32);

    await handleUserMessage({ workspace, userId: user.id, text: "what's scheduled" });
    const afterList = await listChat(workspace.id);
    expect(afterList.at(-1)?.content).toMatch(/Nothing is scheduled/);

    const db = await getDb();
    await db.insert(videos).values({
      workspaceId: workspace.id,
      title: "Approved clip",
      status: "approved",
      aiGenerated: true,
    });
    await handleUserMessage({ workspace, userId: user.id, text: "schedule it tomorrow at 9am" });
    const queued = await db.select().from(scheduleItems).where(eq(scheduleItems.workspaceId, workspace.id));
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe("scheduled");
    const [video] = await db.select().from(videos).where(eq(videos.workspaceId, workspace.id));
    expect(video?.status).toBe("scheduled");
  });
});
