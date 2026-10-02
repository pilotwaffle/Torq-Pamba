import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, lte, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { publishJobs, scheduleItems, videos, workspaces, type PublishTarget } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { allowsInsecureLocalEndpoints } from "@/lib/local-mode";
import { AccountError, validateTargets } from "@/lib/publish/accounts";
import { parseTargets } from "@/lib/publish/config";
import { enqueuePublishJobs, processPublishQueue } from "@/lib/publish/queue";
import { addCalendarDays, validZone, zonedParts, zonedToUtc } from "@/lib/time";

export const SLOT_HOURS = [9, 12, 18] as const;

export const SCHEDULE_BANNER =
  "Posting uses official TikTok, Instagram and Facebook APIs only, on accounts you connect. Torq-Pamba never posts from devices. Items without a connected account are marked 'Ready to publish manually' when they come due.";

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

export function nextGoodSlot(now: Date, timeZone: string): Date {
  const zone = validZone(timeZone);
  const local = zonedParts(now, zone);
  for (let day = 0; day < 8; day += 1) {
    const date = addCalendarDays(local.year, local.month, local.day, day);
    for (const hour of SLOT_HOURS) {
      const candidate = zonedToUtc(date.year, date.month, date.day, hour, 0, zone);
      if (candidate.getTime() > now.getTime()) return candidate;
    }
  }
  const fallback = addCalendarDays(local.year, local.month, local.day, 8);
  return zonedToUtc(fallback.year, fallback.month, fallback.day, 9, 0, zone);
}

export function tomorrowAt(now: Date, timeZone: string, hour = 9, minute = 0): Date {
  const zone = validZone(timeZone);
  const local = zonedParts(now, zone);
  const date = addCalendarDays(local.year, local.month, local.day, 1);
  return zonedToUtc(date.year, date.month, date.day, hour, minute, zone);
}

export function formatWhen(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: validZone(timeZone),
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function parseSlotInput(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const zone = validZone(timeZone);
  const date = zonedToUtc(year, month, day, hour, minute, zone);
  const parts = zonedParts(date, zone);
  if (parts.year !== year || parts.month !== month || parts.day !== day || parts.hour !== hour || parts.minute !== minute) {
    return null;
  }
  return date;
}

export function scheduleStatusLabel(status: string): string {
  if (status === "due_manual") return "Ready to publish manually";
  if (status === "scheduled") return "Scheduled";
  if (status === "canceled") return "Canceled";
  if (status === "publishing") return "Sent to publisher";
  return status;
}

function resolveWhen(when: Date | "next", timeZone: string, now: Date): Date {
  if (when === "next") return nextGoodSlot(now, timeZone);
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) {
    throw new ScheduleError("Choose a valid publish slot");
  }
  return when;
}

async function videoContext(videoId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: videos.id,
      title: videos.title,
      status: videos.status,
      workspaceId: videos.workspaceId,
      timezone: workspaces.timezone,
    })
    .from(videos)
    .innerJoin(workspaces, eq(workspaces.id, videos.workspaceId))
    .where(eq(videos.id, videoId))
    .limit(1);
  return row ?? null;
}

async function itemContext(scheduleItemId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: scheduleItems.id,
      videoId: scheduleItems.videoId,
      workspaceId: scheduleItems.workspaceId,
      status: scheduleItems.status,
      scheduledAt: scheduleItems.scheduledAt,
      timezone: workspaces.timezone,
    })
    .from(scheduleItems)
    .innerJoin(workspaces, eq(workspaces.id, scheduleItems.workspaceId))
    .where(eq(scheduleItems.id, scheduleItemId))
    .limit(1);
  return row ?? null;
}

export async function scheduleVideo(
  videoId: string,
  when: Date | "next",
  actor = "user",
  requestedTargets: PublishTarget[] = [],
) {
  const video = await videoContext(videoId);
  if (!video) throw new ScheduleError("Video not found");
  if (video.status !== "approved") {
    throw new ScheduleError("Only an approved video can be scheduled");
  }
  let targets: PublishTarget[];
  try {
    targets = await validateTargets(video.workspaceId, requestedTargets);
  } catch (error) {
    if (error instanceof AccountError) throw new ScheduleError(error.message);
    throw error;
  }

  const db = await getDb();
  const [existing] = await db
    .select({ id: scheduleItems.id })
    .from(scheduleItems)
    .where(and(eq(scheduleItems.videoId, video.id), ne(scheduleItems.status, "canceled")))
    .limit(1);
  if (existing) throw new ScheduleError("That video is already on the schedule.");

  const scheduledAt = resolveWhen(when, video.timezone, new Date());
  const [created] = await db
    .insert(scheduleItems)
    .values({
      workspaceId: video.workspaceId,
      videoId: video.id,
      scheduledAt,
      status: "scheduled",
      targets,
    })
    .returning();
  if (!created) throw new ScheduleError("Could not schedule the video");

  await db
    .update(videos)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(eq(videos.id, video.id));
  await writeAudit({
    workspaceId: video.workspaceId,
    actor,
    action: "video.scheduled",
    data: {
      videoId: video.id,
      scheduleItemId: created.id,
      scheduledAt: scheduledAt.toISOString(),
      targets: targets.map((target) => target.mode),
    },
  });

  return {
    id: created.id,
    videoId: video.id,
    workspaceId: video.workspaceId,
    scheduledAt,
    status: "scheduled" as const,
    title: video.title || "Untitled",
    targets,
  };
}

export async function reschedule(
  scheduleItemId: string,
  when: Date | "next",
  actor = "user",
  workspaceId?: string,
) {
  const item = await itemContext(scheduleItemId);
  if (!item || (workspaceId && item.workspaceId !== workspaceId)) {
    throw new ScheduleError("Schedule item not found");
  }
  if (item.status === "canceled") throw new ScheduleError("That item is canceled");
  if (item.status === "publishing") throw new ScheduleError("That item was already sent to the publisher");

  const scheduledAt = resolveWhen(when, item.timezone, new Date());
  const db = await getDb();
  await db
    .update(scheduleItems)
    .set({ scheduledAt, status: "scheduled", updatedAt: new Date() })
    .where(eq(scheduleItems.id, item.id));
  await db
    .update(videos)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(eq(videos.id, item.videoId));
  await writeAudit({
    workspaceId: item.workspaceId,
    actor,
    action: "schedule.rescheduled",
    data: { scheduleItemId: item.id, videoId: item.videoId, scheduledAt: scheduledAt.toISOString() },
  });
  return { id: item.id, scheduledAt, status: "scheduled" as const };
}

export async function cancel(scheduleItemId: string, actor = "user", workspaceId?: string) {
  const item = await itemContext(scheduleItemId);
  if (!item || (workspaceId && item.workspaceId !== workspaceId)) {
    throw new ScheduleError("Schedule item not found");
  }
  if (item.status === "canceled") throw new ScheduleError("That item is canceled");

  const db = await getDb();
  await db
    .update(scheduleItems)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(scheduleItems.id, item.id));
  // Jobs not yet picked up are canceled too. Anything already sent stays in the publish log.
  await db
    .update(publishJobs)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(and(eq(publishJobs.scheduleItemId, item.id), eq(publishJobs.status, "queued")));

  const [other] = await db
    .select({ id: scheduleItems.id })
    .from(scheduleItems)
    .where(and(eq(scheduleItems.videoId, item.videoId), ne(scheduleItems.status, "canceled")))
    .limit(1);
  if (!other) {
    await db
      .update(videos)
      .set({ status: "approved", updatedAt: new Date() })
      .where(and(eq(videos.id, item.videoId), eq(videos.status, "scheduled")));
  }

  await writeAudit({
    workspaceId: item.workspaceId,
    actor,
    action: "schedule.canceled",
    data: { scheduleItemId: item.id, videoId: item.videoId },
  });
}

/**
 * Handle scheduled items whose slot has arrived. Items with no connected-account
 * targets move to due_manual (nothing is posted). Items with targets move to
 * "publishing" and get one publish job per target; processPublishQueue runs them.
 */
export async function processDueItems(now: Date, options: { workspaceId?: string } = {}): Promise<string[]> {
  const db = await getDb();
  const filters = [eq(scheduleItems.status, "scheduled"), lte(scheduleItems.scheduledAt, now)];
  if (options.workspaceId) filters.push(eq(scheduleItems.workspaceId, options.workspaceId));
  const due = await db.select().from(scheduleItems).where(and(...filters));

  const moved: string[] = [];
  for (const item of due) {
    const targets = parseTargets(item.targets);
    const next = targets.length > 0 ? "publishing" : "due_manual";
    const [updated] = await db
      .update(scheduleItems)
      .set({ status: next, updatedAt: new Date() })
      .where(and(eq(scheduleItems.id, item.id), eq(scheduleItems.status, "scheduled")))
      .returning({ id: scheduleItems.id });
    if (!updated) continue;
    if (next === "publishing") {
      const jobIds = await enqueuePublishJobs({
        workspaceId: item.workspaceId,
        videoId: item.videoId,
        scheduleItemId: item.id,
        targets,
      });
      await writeAudit({
        workspaceId: item.workspaceId,
        actor: "system",
        action: "schedule.publishing",
        data: { scheduleItemId: item.id, videoId: item.videoId, jobIds },
      });
    } else {
      await writeAudit({
        workspaceId: item.workspaceId,
        actor: "system",
        action: "schedule.due_manual",
        data: {
          scheduleItemId: item.id,
          videoId: item.videoId,
          scheduledAt: item.scheduledAt.toISOString(),
        },
      });
    }
    moved.push(item.id);
  }
  return moved;
}

function tokenMatches(got: string, expected: string): boolean {
  const left = createHash("sha256").update(got).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

/** Require `Bearer <CRON_SECRET>`. With no secret, only explicit local mode is let through. */
export function cronAuthorized(authorization: string | null, secret = process.env.CRON_SECRET): boolean {
  const expected = secret?.trim() ?? "";
  if (!expected) return allowsInsecureLocalEndpoints();
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization?.trim() ?? "");
  if (!match?.[1]) return false;
  return tokenMatches(match[1], expected);
}

export async function handleCronTick(authorization: string | null, now = new Date()) {
  if (!cronAuthorized(authorization)) {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  const due = await processDueItems(now);
  const jobs = await processPublishQueue();
  return { status: 200, body: { ok: true, due: due.length, jobsSucceeded: jobs.succeeded, jobsFailed: jobs.failed } };
}

export async function scheduleApprovedVideo(input: {
  workspaceId: string;
  actor: string;
  when: Date | "next";
}): Promise<{ ok: true; scheduledAt: Date; title: string } | { ok: false; message: string }> {
  const db = await getDb();
  const [video] = await db
    .select()
    .from(videos)
    .where(and(eq(videos.workspaceId, input.workspaceId), eq(videos.status, "approved")))
    .orderBy(desc(videos.updatedAt))
    .limit(1);
  if (!video) {
    return { ok: false, message: "Approve a video first. Nothing is scheduled without approval." };
  }
  try {
    const item = await scheduleVideo(video.id, input.when, input.actor);
    return { ok: true, scheduledAt: item.scheduledAt, title: item.title };
  } catch (error) {
    if (error instanceof ScheduleError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function listSchedule(workspaceId: string) {
  const db = await getDb();
  return db
    .select({
      id: scheduleItems.id,
      status: scheduleItems.status,
      scheduledAt: scheduleItems.scheduledAt,
      targets: scheduleItems.targets,
      title: videos.title,
      videoId: videos.id,
    })
    .from(scheduleItems)
    .innerJoin(videos, eq(scheduleItems.videoId, videos.id))
    .where(and(eq(scheduleItems.workspaceId, workspaceId), ne(scheduleItems.status, "canceled")))
    .orderBy(asc(scheduleItems.scheduledAt));
}

export async function activeItemForVideo(videoId: string) {
  const db = await getDb();
  const [item] = await db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.videoId, videoId), ne(scheduleItems.status, "canceled")))
    .limit(1);
  return item ?? null;
}
