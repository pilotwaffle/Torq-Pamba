import { bigint, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users, workspaces } from "./core";
import { ideaSource, ideaStatus, inspirationKind, socialPlatform, trendKind } from "./enums";

const score = (name: string) => numeric(name, { precision: 10, scale: 2, mode: "number" });

export const inspirationAccounts = pgTable(
  "inspiration_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: socialPlatform("platform").notNull(),
    /** Lower-case handle without `@`. */
    handle: text("handle").notNull(),
    kind: inspirationKind("kind").notNull().default("inspiration"),
    displayName: text("display_name"),
    profileUrl: text("profile_url"),
    followerCount: bigint("follower_count", { mode: "number" }),
    notes: text("notes"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    syncError: text("sync_error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("inspiration_accounts_handle_idx").on(table.workspaceId, table.platform, table.handle)],
);

/** Discover library: public posts found through sanctioned sources, scoped to one workspace. */
export const viralPosts = pgTable(
  "viral_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => inspirationAccounts.id, { onDelete: "set null" }),
    platform: socialPlatform("platform").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    authorHandle: text("author_handle"),
    caption: text("caption"),
    hook: text("hook"),
    transcript: text("transcript"),
    thumbnailUrl: text("thumbnail_url"),
    durationMs: integer("duration_ms"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    views: bigint("views", { mode: "number" }),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    saves: bigint("saves", { mode: "number" }),
    /** Views relative to the author's median, or another outlier measure. */
    outlierScore: score("outlier_score"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("viral_posts_external_idx").on(table.workspaceId, table.platform, table.externalId),
    index("viral_posts_workspace_idx").on(table.workspaceId, table.discoveredAt),
    index("viral_posts_account_idx").on(table.accountId),
  ],
);

export const trends = pgTable(
  "trends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: socialPlatform("platform"),
    kind: trendKind("kind").notNull(),
    label: text("label").notNull(),
    niche: text("niche"),
    score: score("score"),
    volume: bigint("volume", { mode: "number" }),
    growthPct: score("growth_pct"),
    url: text("url"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("trends_workspace_idx").on(table.workspaceId, table.observedAt)],
);

export const ideas = pgTable(
  "ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    hook: text("hook"),
    angle: text("angle"),
    status: ideaStatus("status").notNull().default("new"),
    source: ideaSource("source").notNull().default("agent"),
    viralPostId: uuid("viral_post_id").references(() => viralPosts.id, { onDelete: "set null" }),
    trendId: uuid("trend_id").references(() => trends.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ideas_workspace_idx").on(table.workspaceId, table.status, table.createdAt)],
);
