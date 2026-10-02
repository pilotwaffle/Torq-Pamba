import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { money } from "./columns";
import { users, videos } from "./core";
import { contentSource, takeStatus } from "./enums";
import { generationJobs, mediaAssets } from "./media";

export const videoScenes = pgTable(
  "video_scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    visual: text("visual").notNull().default(""),
    line: text("line").notNull().default(""),
    durationMs: integer("duration_ms").notNull(),
    selectedTakeId: uuid("selected_take_id").references((): AnyPgColumn => sceneTakes.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("video_scenes_position_idx").on(table.videoId, table.position),
    check("video_scenes_duration_check", sql`${table.durationMs} > 0`),
  ],
);

/** A generated clip for a scene. A scene can have many takes; the editor picks one. */
export const sceneTakes = pgTable(
  "scene_takes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => videoScenes.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    status: takeStatus("status").notNull().default("pending"),
    provider: text("provider"),
    model: text("model"),
    prompt: text("prompt").notNull().default(""),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    clipAssetId: uuid("clip_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    posterAssetId: uuid("poster_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    voiceAssetId: uuid("voice_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    lipsyncJobId: uuid("lipsync_job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    lipsyncAssetId: uuid("lipsync_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    durationMs: integer("duration_ms"),
    costUsd: money("cost_usd").notNull().default(0),
    credits: integer("credits").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("scene_takes_number_idx").on(table.sceneId, table.number),
    index("scene_takes_job_idx").on(table.jobId),
  ],
);

export const videoCaptions = pgTable(
  "video_captions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    sceneId: uuid("scene_id").references(() => videoScenes.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    text: text("text").notNull(),
    source: contentSource("source").notNull().default("ai"),
    style: jsonb("style").$type<Record<string, unknown>>(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("video_captions_video_idx").on(table.videoId, table.startMs),
    check("video_captions_range_check", sql`${table.startMs} >= 0 AND ${table.endMs} >= ${table.startMs}`),
  ],
);

/** Text-hook variants. At most one per video is selected (partial unique index). */
export const videoHooks = pgTable(
  "video_hooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    source: contentSource("source").notNull().default("ai"),
    isSelected: boolean("is_selected").notNull().default(false),
    startMs: integer("start_ms").notNull().default(0),
    endMs: integer("end_ms"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("video_hooks_position_idx").on(table.videoId, table.position),
    uniqueIndex("video_hooks_selected_idx").on(table.videoId).where(sql`${table.isSelected}`),
  ],
);
