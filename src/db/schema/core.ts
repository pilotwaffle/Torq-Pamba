import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { conversations } from "./chat";
import { money } from "./columns";
import { plans } from "./credits";
import {
  attemptStatus,
  billingInterval,
  memberRole,
  scheduleStatus,
  videoStatus,
  videoTier,
  workspacePlan,
} from "./enums";
import { generationJobs, mediaAssets, videoRenders } from "./media";
import { ideas } from "./research";
import { voices } from "./voices";

export type BrandBrief = {
  companyName?: string;
  niche?: string;
  whatTheyDo?: string;
  products?: string[];
  audience?: string;
  tone?: string;
  logoUrl?: string;
  websiteUrl?: string;
};

/** One official-API destination chosen when a video is scheduled. */
export type PublishTarget = {
  accountId: string;
  /** tiktok: direct | draft. instagram: reel | trial_reel. facebook: reel. */
  mode: string;
};

export type AvatarScene = {
  name?: string;
  startFrame?: string;
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  brief: jsonb("brief").$type<BrandBrief>(),
  budgetCapUsd: money("budget_cap_usd").notNull().default(25),
  aiDisclosureDefault: boolean("ai_disclosure_default").notNull().default(true),
  plan: workspacePlan("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  planId: text("plan_id")
    .notNull()
    .default("free")
    .references((): AnyPgColumn => plans.id, { onDelete: "restrict" }),
  /** Cached sum of `credit_ledger.delta`. Update it in the same transaction as the ledger row. */
  creditBalance: integer("credit_balance").notNull().default(0),
  billingInterval: billingInterval("billing_interval"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  planPeriodEndsAt: timestamp("plan_period_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("members_workspace_user_idx").on(table.workspaceId, table.userId),
    index("members_user_idx").on(table.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    role: memberRole("role").notNull().default("member"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("invites_workspace_idx").on(table.workspaceId)],
);

/** Brand library entries (site imports, URLs, uploads). The stored file, when there is one, is `media_asset_id`. */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    kind: text("kind").notNull().default("image"),
    sourceSnippet: text("source_snippet"),
    rightsConfirmed: boolean("rights_confirmed").notNull().default(false),
    mediaAssetId: uuid("media_asset_id").references((): AnyPgColumn => mediaAssets.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("assets_workspace_idx").on(table.workspaceId)],
);

export const avatars = pgTable(
  "avatars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    look: text("look").notNull().default(""),
    /** Legacy stock voice label id (`STOCK_VOICES`). The voice used for TTS is `tts_voice_id`. */
    voiceId: text("voice_id").notNull().default(""),
    scenes: jsonb("scenes").$type<AvatarScene[]>().notNull().default([]),
    source: text("source").notNull().default("stock"),
    image: text("image"),
    isDefault: boolean("is_default").notNull().default(false),
    ttsVoiceId: uuid("tts_voice_id").references((): AnyPgColumn => voices.id, { onDelete: "set null" }),
    portraitAssetId: uuid("portrait_asset_id").references((): AnyPgColumn => mediaAssets.id, {
      onDelete: "set null",
    }),
    /** Video model id of the lip-sync engine for this avatar, e.g. `kling-avatar`. */
    lipsyncModel: text("lipsync_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("avatars_workspace_idx").on(table.workspaceId)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Null for messages written before conversations existed (the workspace's default thread). */
    conversationId: uuid("conversation_id").references((): AnyPgColumn => conversations.id, {
      onDelete: "cascade",
    }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_workspace_idx").on(table.workspaceId, table.createdAt),
    index("chat_messages_conversation_idx").on(table.conversationId, table.createdAt),
  ],
);

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    avatarId: uuid("avatar_id").references(() => avatars.id, { onDelete: "set null" }),
    title: text("title").notNull().default(""),
    prompt: text("prompt").notNull().default(""),
    status: videoStatus("status").notNull().default("draft"),
    tier: videoTier("tier"),
    model: text("model"),
    plan: jsonb("plan").$type<Record<string, unknown>>(),
    costEstimate: jsonb("cost_estimate").$type<Record<string, unknown>>(),
    costActualUsd: money("cost_actual_usd"),
    aiGenerated: boolean("ai_generated").notNull().default(true),
    manifest: jsonb("manifest").$type<Record<string, unknown>>(),
    /** Storage key of the stitched MP4, when live providers returned real clips. */
    mediaKey: text("media_key"),
    approval: jsonb("approval").$type<Record<string, unknown>>(),
    /** The stitched mp4 shown and published for this video. */
    currentRenderId: uuid("current_render_id").references((): AnyPgColumn => videoRenders.id, {
      onDelete: "set null",
    }),
    conversationId: uuid("conversation_id").references((): AnyPgColumn => conversations.id, {
      onDelete: "set null",
    }),
    ideaId: uuid("idea_id").references((): AnyPgColumn => ideas.id, { onDelete: "set null" }),
    creditsCharged: integer("credits_charged").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("videos_workspace_idx").on(table.workspaceId, table.createdAt)],
);

export const generationAttempts = pgTable(
  "generation_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: attemptStatus("status").notNull(),
    costUsd: money("cost_usd").notNull().default(0),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    jobId: uuid("job_id").references((): AnyPgColumn => generationJobs.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("generation_attempts_video_idx").on(table.videoId)],
);

export const scheduleItems = pgTable(
  "schedule_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: scheduleStatus("status").notNull().default("scheduled"),
    targets: jsonb("targets").$type<PublishTarget[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("schedule_items_due_idx").on(table.status, table.scheduledAt),
    index("schedule_items_workspace_idx").on(table.workspaceId),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_log_workspace_idx").on(table.workspaceId, table.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Invite = typeof invites.$inferSelect;
