import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as cronTick } from "@/app/api/cron/tick/route";
import { getDb } from "@/db";
import { auditLog, scheduleItems, videos, workspaces } from "@/db/schema";
import { handleUserMessage } from "@/lib/agent/run";
import { signupAccount } from "@/lib/auth/account";
import {
  SCHEDULE_BANNER,
  cancel,
  cronAuthorized,
  nextGoodSlot,
  processDueItems,
  reschedule,
  scheduleVideo,
} from "@/lib/schedule";
import { zonedParts } from "@/lib/time";

const password = "correct-horse-battery";

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

async function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

describe("nextGoodSlot", () => {
  it("returns the next 09:00, 12:00, or 18:00 in the given timezone", () => {
    expect(nextGoodSlot(new Date("2026-09-26T08:00:00Z"), "UTC").toISOString()).toBe("2026-09-26T09:00:00.000Z");
    expect(nextGoodSlot(new Date("2026-09-26T09:00:00Z"), "UTC").toISOString()).toBe("2026-09-26T12:00:00.000Z");
    expect(nextGoodSlot(new Date("2026-09-26T15:00:00Z"), "UTC").toISOString()).toBe("2026-09-26T18:00:00.000Z");
    expect(nextGoodSlot(new Date("2026-09-26T18:00:00Z"), "UTC").toISOString()).toBe("2026-09-27T09:00:00.000Z");
    // 12:30 UTC is 08:30 in New York (EDT). The next local slot is 09:00.
    expect(nextGoodSlot(new Date("2026-09-26T12:30:00Z"), "America/New_York").toISOString()).toBe(
      "2026-09-26T13:00:00.000Z",
    );
  });
});

describe("scheduleVideo", () => {
  it("schedules only an approved video and rejects every other status", async () => {
    const { workspace, user } = await signupAccount({
      email: email("sched"),
      password,
      workspaceName: "Schedule Co",
    });
    const db = await getDb();
    for (const status of ["draft", "planned", "generating", "ready", "failed", "scheduled"] as const) {
      const [video] = await db
        .insert(videos)
        .values({ workspaceId: workspace.id, title: status, status, aiGenerated: true })
        .returning();
      await expect(scheduleVideo(video.id, "next", user.id)).rejects.toThrow(/approved/i);
    }

    const [approved] = await db
      .insert(videos)
      .values({ workspaceId: workspace.id, title: "Approved clip", status: "approved", aiGenerated: true })
      .returning();
    await db.update(workspaces).set({ timezone: "America/New_York" }).where(eq(workspaces.id, workspace.id));
    const item = await scheduleVideo(approved.id, "next", user.id);
    expect(item.status).toBe("scheduled");
    const parts = zonedParts(item.scheduledAt, "America/New_York");
    expect([9, 12, 18]).toContain(parts.hour);
    expect(parts.minute).toBe(0);
    expect(item.scheduledAt.getTime()).toBeGreaterThan(Date.now() - 1000);

    const [stored] = await db.select().from(videos).where(eq(videos.id, approved.id));
    expect(stored?.status).toBe("scheduled");
    await db.update(videos).set({ status: "approved" }).where(eq(videos.id, approved.id));
    await expect(scheduleVideo(approved.id, new Date(), user.id)).rejects.toThrow(/already on the schedule/i);
  });

  it("lets the chat agent schedule the next slot of an approved video", async () => {
    const { workspace, user } = await signupAccount({
      email: email("agent-slot"),
      password,
      workspaceName: "Agent Slot",
    });
    const db = await getDb();
    await handleUserMessage({ workspace, userId: user.id, text: "schedule it tomorrow at 9am" });
    const blocked = await db.select().from(scheduleItems).where(eq(scheduleItems.workspaceId, workspace.id));
    expect(blocked).toHaveLength(0);

    await db.insert(videos).values({
      workspaceId: workspace.id,
      title: "Approved clip",
      status: "approved",
      aiGenerated: true,
    });
    await handleUserMessage({ workspace, userId: user.id, text: "next good slot" });
    const queued = await db.select().from(scheduleItems).where(eq(scheduleItems.workspaceId, workspace.id));
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe("scheduled");
  });
});

describe("processDueItems", () => {
  it("moves due rows to due_manual, writes an audit row, and never marks them published", async () => {
    const { workspace, user } = await signupAccount({
      email: email("due"),
      password,
      workspaceName: "Due Co",
    });
    const db = await getDb();
    const [dueVideo] = await db
      .insert(videos)
      .values({ workspaceId: workspace.id, title: "Due clip", status: "approved", aiGenerated: true })
      .returning();
    const [laterVideo] = await db
      .insert(videos)
      .values({ workspaceId: workspace.id, title: "Later clip", status: "approved", aiGenerated: true })
      .returning();
    const due = await scheduleVideo(dueVideo.id, new Date(Date.now() - 60_000), user.id);
    const later = await scheduleVideo(laterVideo.id, new Date(Date.now() + 86_400_000), user.id);

    const moved = await processDueItems(new Date());
    expect(moved).toContain(due.id);

    const [dueRow] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, due.id));
    const [laterRow] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, later.id));
    expect(dueRow?.status).toBe("due_manual");
    expect(laterRow?.status).toBe("scheduled");
    expect(dueRow?.status).not.toBe("published");
    expect(laterRow?.status).not.toBe("published");

    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspace.id));
    expect(audits.some((entry) => entry.action === "schedule.due_manual")).toBe(true);
    expect(audits.some((entry) => entry.action.toLowerCase().includes("publish"))).toBe(false);

    const again = await processDueItems(new Date());
    expect(again).not.toContain(due.id);

    await reschedule(due.id, new Date(Date.now() + 3_600_000), user.id);
    const [rescheduled] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, due.id));
    expect(rescheduled?.status).toBe("scheduled");

    await cancel(due.id, user.id);
    const [canceled] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, due.id));
    expect(canceled?.status).toBe("canceled");
    const [video] = await db.select().from(videos).where(eq(videos.id, dueVideo.id));
    expect(video?.status).toBe("approved");
  });
});

describe("cron auth", () => {
  it("requires Bearer CRON_SECRET when the secret is set, and calls processDueItems", async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "tick-secret";
    try {
      expect(cronAuthorized(null)).toBe(false);
      expect(cronAuthorized("Bearer wrong")).toBe(false);
      expect(cronAuthorized("Bearer tick-secret")).toBe(true);

      const { workspace, user } = await signupAccount({
        email: email("cron"),
        password,
        workspaceName: "Cron Co",
      });
      const db = await getDb();
      const [video] = await db
        .insert(videos)
        .values({ workspaceId: workspace.id, title: "Cron clip", status: "approved", aiGenerated: true })
        .returning();
      const item = await scheduleVideo(video.id, new Date(Date.now() - 5_000), user.id);

      const denied = await cronTick(new Request("http://localhost/api/cron/tick", { method: "POST" }));
      expect(denied.status).toBe(401);
      const [still] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, item.id));
      expect(still?.status).toBe("scheduled");

      const allowed = await cronTick(
        new Request("http://localhost/api/cron/tick", {
          method: "POST",
          headers: { authorization: "Bearer tick-secret" },
        }),
      );
      expect(allowed.status).toBe(200);
      const body = (await allowed.json()) as { ok?: boolean; due?: number };
      expect(body.ok).toBe(true);
      expect(body.due).toBeGreaterThanOrEqual(1);
      const [ready] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, item.id));
      expect(ready?.status).toBe("due_manual");
      expect(JSON.stringify(body)).not.toContain("published");
    } finally {
      await restoreEnv("CRON_SECRET", previous);
    }
  });

  it("allows the tick when CRON_SECRET is unset", async () => {
    const previous = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      expect(cronAuthorized("Bearer anything")).toBe(true);
      const open = await cronTick(new Request("http://localhost/api/cron/tick", { method: "POST" }));
      expect(open.status).toBe(200);
    } finally {
      await restoreEnv("CRON_SECRET", previous);
    }
  });
});

describe("publish endpoints", () => {
  it("keeps the queue banner and finds no forbidden publish endpoints under src/", async () => {
    expect(SCHEDULE_BANNER).toContain("Ready to publish manually");
    const root = path.join(process.cwd(), "src");
    const needles = [
      "open.tiktokapis.com/v2/post/" + "publish",
      "media_" + "publish",
      "video_" + "reels",
    ];
    const hits: string[] = [];
    async function walk(dir: string) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        const text = await readFile(full, "utf8");
        for (const needle of needles) {
          if (text.includes(needle)) hits.push(`${path.relative(root, full)}: ${needle}`);
        }
      }
    }
    await walk(root);
    expect(hits).toEqual([]);
  });
});
