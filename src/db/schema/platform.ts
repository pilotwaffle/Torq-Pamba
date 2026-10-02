import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users, videos, workspaces } from "./core";
import { knowledgeKind, knowledgeSource } from "./enums";

/** Workspace memory: brand facts, preferences, and lessons from analytics (the learning loop). */
export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: knowledgeKind("kind").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    source: knowledgeSource("source").notNull().default("user"),
    /** Where an agent or analytics learning came from, e.g. `{ publishAttemptId }`. */
    sourceRef: jsonb("source_ref").$type<Record<string, unknown>>(),
    videoId: uuid("video_id").references(() => videos.id, { onDelete: "set null" }),
    confidence: numeric("confidence", { precision: 4, scale: 3, mode: "number" }),
    pinned: boolean("pinned").notNull().default(false),
    tags: text("tags").array().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [index("knowledge_items_workspace_idx").on(table.workspaceId, table.kind)],
);

/**
 * REST / MCP API keys. Only the SHA-256 of the full key is stored, plus a short
 * prefix for display. The plaintext key is shown once at creation.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").array().notNull().default([]),
    readOnly: boolean("read_only").notNull().default(false),
    /** Monthly credit cap for calls made with this key (Pamba's `max_credits`). Null = workspace limit only. */
    maxCredits: integer("max_credits"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_keys_workspace_idx").on(table.workspaceId)],
);
