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
import { connectionStatus, publishStatus, socialPlatform } from "./enums";
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
