import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { scheduleItems, users, videos, workspaces } from "./core";
import { connectionStatus, publishJobStatus, publishStatus, socialPlatform } from "./enums";
import { videoRenders } from "./media";

// Wave 2: official-API publishing only (TikTok Content Posting, Instagram
// Graph, Facebook Pages) after app review. No device or managed-account posting.

/** An OAuth connection. Tokens are stored only as ciphertext; plaintext tokens never touch the database. */
export const publishingConnections = pgTable(
  "publishing_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: socialPlatform("platform").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    displayName: text("display_name"),
    scopes: text("scopes").array().notNull().default([]),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    /** Which encryption key version produced the ciphertext, for key rotation. */
    tokenKeyVersion: integer("token_key_version").notNull().default(1),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    status: connectionStatus("status").notNull().default("active"),
    lastError: text("last_error"),
    connectedBy: uuid("connected_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("publishing_connections_account_idx").on(
      table.workspaceId,
      table.platform,
      table.externalAccountId,
    ),
  ],
);

export const publishAttempts = pgTable(
  "publish_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    scheduleItemId: uuid("schedule_item_id").references(() => scheduleItems.id, { onDelete: "set null" }),
    connectionId: uuid("connection_id").references(() => publishingConnections.id, { onDelete: "set null" }),
    renderId: uuid("render_id").references(() => videoRenders.id, { onDelete: "set null" }),
    platform: socialPlatform("platform").notNull(),
    status: publishStatus("status").notNull().default("pending"),
    /** Sent as the platform's AI-generated flag (TikTok `is_aigc`, IG `is_ai_generated`). */
    aiDisclosure: boolean("ai_disclosure").notNull().default(true),
    attempt: integer("attempt").notNull().default(1),
    externalPostId: text("external_post_id"),
    externalUrl: text("external_url"),
    error: text("error"),
    request: jsonb("request").$type<Record<string, unknown>>(),
    response: jsonb("response").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("publish_attempts_workspace_idx").on(table.workspaceId, table.createdAt),
    index("publish_attempts_schedule_idx").on(table.scheduleItemId),
    uniqueIndex("publish_attempts_external_idx").on(table.platform, table.externalPostId),
  ],
);

/** Point-in-time metrics for a published post. One row per poll. */
export const postAnalyticsSnapshots = pgTable(
  "post_analytics_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    publishAttemptId: uuid("publish_attempt_id")
      .notNull()
      .references(() => publishAttempts.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    views: bigint("views", { mode: "number" }),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    saves: bigint("saves", { mode: "number" }),
    watchTimeMs: bigint("watch_time_ms", { mode: "number" }),
    avgWatchPct: numeric("avg_watch_pct", { precision: 5, scale: 2, mode: "number" }),
    followersGained: integer("followers_gained"),
    data: jsonb("data").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("post_analytics_attempt_idx").on(table.publishAttemptId, table.capturedAt),
    index("post_analytics_workspace_idx").on(table.workspaceId, table.capturedAt),
  ],
);

// ---------------------------------------------------------------------------
// Phase 2 publishing (ported from feat/phase2-plus). These tables back the
// implemented TikTok / Instagram / Facebook publish queue. They predate the
// wave-0 placeholders above (publishing_connections, publish_attempts,
// post_analytics_snapshots), which stay untouched; consolidating the two is an
// owner decision recorded in REPORT.md.
// ---------------------------------------------------------------------------

/** Phase 2 publishes to these three only; the shared enum also reserves `youtube`. */
type PhasePlatform = "tiktok" | "instagram" | "facebook";

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: socialPlatform("platform").$type<PhasePlatform>().notNull(),
    externalId: text("external_id").notNull(),
    handle: text("handle").notNull(),
    /** "mock" accounts never reach a platform. "live" accounts came from official OAuth. */
    mode: text("mode").notNull().default("mock"),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    scopes: text("scopes").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    connectedBy: uuid("connected_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("social_accounts_workspace_idx").on(table.workspaceId)],
);

export const publishJobs = pgTable(
  "publish_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    scheduleItemId: uuid("schedule_item_id").references(() => scheduleItems.id, { onDelete: "set null" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    platform: socialPlatform("platform").$type<PhasePlatform>().notNull(),
    mode: text("mode").notNull(),
    status: publishJobStatus("status").notNull().default("queued"),
    privacy: text("privacy").notNull().default(""),
    externalId: text("external_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("publish_jobs_status_idx").on(table.status),
    index("publish_jobs_workspace_idx").on(table.workspaceId, table.createdAt),
  ],
);

/** Append-only publish status log, one row per state change or platform status poll. */
export const publishEvents = pgTable(
  "publish_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => publishJobs.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("publish_events_job_idx").on(table.jobId, table.createdAt)],
);

export const postMetrics = pgTable(
  "post_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => publishJobs.id, { onDelete: "cascade" }),
    platform: socialPlatform("platform").$type<PhasePlatform>().notNull(),
    views: integer("views").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("post_metrics_job_idx").on(table.jobId, table.fetchedAt)],
);
