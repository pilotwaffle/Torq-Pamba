import { sql } from "drizzle-orm";
import {
  bigint,
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
import { users, videos, workspaces } from "./core";
import { jobKind, jobStatus, mediaKind, mediaSource, renderStatus, storageDriver } from "./enums";

/** A stored file: generated clip, upload, voice track, poster, or final render. */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: mediaKind("kind").notNull(),
    source: mediaSource("source").notNull(),
    storage: storageDriver("storage").notNull(),
    /** Object key or disk path. Null for `inline` and `external`. */
    storageKey: text("storage_key"),
    url: text("url").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256"),
    originalFilename: text("original_filename"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("media_assets_workspace_idx").on(table.workspaceId, table.createdAt),
    uniqueIndex("media_assets_storage_key_idx").on(table.storage, table.storageKey),
    check("media_assets_size_check", sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`),
    check("media_assets_duration_check", sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`),
  ],
);

/** One async provider job (clip, image, TTS, voice clone, lip-sync, render) and its polling state. */
export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    videoId: uuid("video_id").references(() => videos.id, { onDelete: "cascade" }),
    kind: jobKind("kind").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    /** The vendor's operation / task / request id. */
    providerJobId: text("provider_job_id"),
    status: jobStatus("status").notNull().default("queued"),
    request: jsonb("request").$type<Record<string, unknown>>(),
    response: jsonb("response").$type<Record<string, unknown>>(),
    error: text("error"),
    pollCount: integer("poll_count").notNull().default(0),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    /** Give up (status `timed_out`) after this instant. */
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    outputAssetId: uuid("output_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    costUsd: money("cost_usd").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("generation_jobs_poll_idx").on(table.status, table.nextPollAt),
    index("generation_jobs_workspace_idx").on(table.workspaceId, table.createdAt),
    index("generation_jobs_video_idx").on(table.videoId),
    uniqueIndex("generation_jobs_provider_job_idx").on(table.provider, table.providerJobId),
  ],
);

/** A stitched, encoded output for a video. `videos.current_render_id` points at the one in use. */
export const videoRenders = pgTable(
  "video_renders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    status: renderStatus("status").notNull().default("queued"),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    outputAssetId: uuid("output_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    posterAssetId: uuid("poster_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    durationMs: integer("duration_ms"),
    /** Snapshot of the scenes, selected takes, captions and hook this render used. */
    manifest: jsonb("manifest").$type<Record<string, unknown>>(),
    captionsBurnedIn: boolean("captions_burned_in").notNull().default(true),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("video_renders_video_idx").on(table.videoId, table.createdAt)],
);
