import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { videos, workspaces } from "./core";
import { adHandoffKind, adHandoffStatus, experimentStatus } from "./enums";
import { publishAttempts, publishingConnections } from "./publishing";

// Phase 3: reach engine (ported from feat/phase2-plus). Hook tests run as
// Instagram Trial Reels through the phase 2 publish queue (publish_attempts);
// winners are written to the foundation's knowledge_items. Column names that
// say "job" or "account" are kept from 0003 and point at publish_attempts and
// publishing_connections since 0005.

/** One hook test: the approved base video plus re-cut variants with different opening hooks. */
export const hookExperiments = pgTable(
  "hook_experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    baseVideoId: uuid("base_video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    status: experimentStatus("status").notNull().default("draft"),
    /** views | engagement */
    metric: text("metric").notNull().default("views"),
    minViews: integer("min_views").notNull().default(300),
    accountId: uuid("account_id").references(() => publishingConnections.id, { onDelete: "set null" }),
    winnerVariantId: uuid("winner_variant_id"),
    decision: jsonb("decision").$type<Record<string, unknown>>(),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    launchedAt: timestamp("launched_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [index("hook_experiments_workspace_idx").on(table.workspaceId, table.createdAt)],
);

export const hookVariants = pgTable(
  "hook_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => hookExperiments.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    pattern: text("pattern").notNull(),
    hook: text("hook").notNull(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    publishJobId: uuid("publish_job_id").references(() => publishAttempts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("hook_variants_label_idx").on(table.experimentId, table.label)],
);

/** Spark Ads / partnership-ads hand-off. The customer runs the ad in their own Ads Manager. */
export const adHandoffs = pgTable(
  "ad_handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => publishAttempts.id, { onDelete: "set null" }),
    kind: adHandoffKind("kind").notNull(),
    status: adHandoffStatus("status").notNull().default("awaiting_creator"),
    creatorHandle: text("creator_handle").notNull().default(""),
    /** Sealed (AES-256-GCM) Spark Ads authorization code. */
    codeEnc: text("code_enc"),
    codeHint: text("code_hint"),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ad_handoffs_workspace_idx").on(table.workspaceId, table.createdAt)],
);

export type CreatorDeliverable = { platform: "tiktok" | "instagram" | "facebook"; format: string; count: number; lengthS: number };
export type CreatorBriefBody = {
  product: string;
  audience: string;
  deliverables: CreatorDeliverable[];
  hooks: string[];
  talkingPoints: string[];
  dos: string[];
  donts: string[];
  usageRightsDays: number;
  allowSparkAds: boolean;
  allowPartnershipAds: boolean;
  budgetUsd: number;
  dueDate: string;
  marketplaces: ("tiktok_one" | "billo" | "collabstr")[];
  disclosure: string;
  referenceVideoTitle: string;
};

export const creatorBriefs = pgTable(
  "creator_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    videoId: uuid("video_id").references(() => videos.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: jsonb("body").$type<CreatorBriefBody>().notNull(),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("creator_briefs_workspace_idx").on(table.workspaceId, table.createdAt)],
);
