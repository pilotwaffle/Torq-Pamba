import { boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users, workspaces } from "./core";
import { voiceCloneStatus, voiceKind } from "./enums";
import { generationJobs, mediaAssets } from "./media";

/** TTS voices. `workspace_id` is null for the shared catalog and set for a workspace's own clones. */
export const voices = pgTable(
  "voices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    kind: voiceKind("kind").notNull(),
    provider: text("provider").notNull(),
    providerVoiceId: text("provider_voice_id").notNull(),
    name: text("name").notNull(),
    language: text("language").notNull().default("en"),
    accent: text("accent"),
    description: text("description"),
    previewUrl: text("preview_url"),
    isPremium: boolean("is_premium").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("voices_provider_voice_idx").on(table.provider, table.providerVoiceId),
    index("voices_workspace_idx").on(table.workspaceId),
  ],
);

/** A voice-clone request. Cloning needs the speaker's recorded consent before any provider call. */
export const voiceClones = pgTable(
  "voice_clones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** The resulting voice, once the provider finishes. */
    voiceId: uuid("voice_id").references(() => voices.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    status: voiceCloneStatus("status").notNull().default("awaiting_consent"),
    speakerName: text("speaker_name").notNull(),
    consentStatement: text("consent_statement"),
    consentAssetId: uuid("consent_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    consentedBy: uuid("consented_by").references(() => users.id, { onDelete: "set null" }),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    provider: text("provider"),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    error: text("error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("voice_clones_workspace_idx").on(table.workspaceId)],
);

export const voiceCloneSamples = pgTable(
  "voice_clone_samples",
  {
    cloneId: uuid("clone_id")
      .notNull()
      .references(() => voiceClones.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.cloneId, table.assetId] })],
);
