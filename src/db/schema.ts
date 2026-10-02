import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);
export const workspacePlan = pgEnum("workspace_plan", ["free", "creator", "studio"]);
export const videoStatus = pgEnum("video_status", [
  "draft",
  "planned",
  "generating",
  "ready",
  "approved",
  "scheduled",
  "failed",
]);
export const videoTier = pgEnum("video_tier", ["budget", "standard", "premium"]);
export const attemptStatus = pgEnum("attempt_status", ["ok", "refused", "error"]);
export const scheduleStatus = pgEnum("schedule_status", ["scheduled", "due_manual", "canceled", "publishing"]);
export const socialPlatform = pgEnum("social_platform", ["tiktok", "instagram", "facebook"]);
export const publishJobStatus = pgEnum("publish_job_status", [
  "queued",
  "processing",
  "succeeded",
  "failed",
  "canceled",
]);

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

const money = (name: string) =>
  numeric(name, { precision: 12, scale: 2, mode: "number" });

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
    voiceId: text("voice_id").notNull().default(""),
    scenes: jsonb("scenes").$type<AvatarScene[]>().notNull().default([]),
    source: text("source").notNull().default("stock"),
    image: text("image"),
    isDefault: boolean("is_default").notNull().default(false),
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
    role: text("role").notNull(),
    content: text("content").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chat_messages_workspace_idx").on(table.workspaceId, table.createdAt)],
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

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: socialPlatform("platform").notNull(),
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
    platform: socialPlatform("platform").notNull(),
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
    platform: socialPlatform("platform").notNull(),
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

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type SocialAccount = typeof socialAccounts.$inferSelect;
export type PublishJob = typeof publishJobs.$inferSelect;
