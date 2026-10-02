import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { money } from "./columns";
import { users, videos, workspaces } from "./core";
import { apiCredentialKind, apiScope, knowledgeKind, knowledgeSource } from "./enums";

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
    /** Added in 0005. Ranking within a kind; for a hook-test winner it is the lift in percent. */
    score: integer("score").notNull().default(0),
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
    /**
     * Added in 0005 (phase 4 port). `key` = a workspace API key; `oauth_access` /
     * `oauth_refresh` = tokens from the MCP OAuth server, stored hashed like keys.
     */
    kind: apiCredentialKind("kind").notNull().default("key"),
    /** Added in 0005. Groups one OAuth grant's rotating tokens. A key is its own grant (grant_id = id; null is read the same way). */
    grantId: uuid("grant_id"),
    /** Added in 0005. The OAuth client a token was issued to. */
    clientId: text("client_id"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_keys_workspace_idx").on(table.workspaceId), index("api_keys_grant_idx").on(table.grantId)],
);

// ---------------------------------------------------------------------------
// Phase 4 platform (ported from feat/phase2-plus): REST v1, the MCP server and
// its OAuth 2.1 authorization server, and done-with-you leads. Keys and OAuth
// tokens live in `api_keys` above (0005 added kind, grant_id, client_id); the
// per-grant monthly ceiling is `api_keys.max_credits`.
// ---------------------------------------------------------------------------

/**
 * One row per authenticated API or MCP call. cost_usd and credits are non-zero
 * only for a successful generation. grant_id is the key's id or the OAuth grant.
 */
export const apiRequests = pgTable(
  "api_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    grantId: uuid("grant_id").notNull(),
    surface: text("surface").notNull(),
    operation: text("operation").notNull(),
    status: integer("status").notNull(),
    costUsd: money("cost_usd").notNull().default(0),
    /** Added in 0005. Credits counted against `api_keys.max_credits`. */
    credits: integer("credits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_requests_grant_idx").on(table.grantId, table.createdAt)],
);

export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id").notNull().unique(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthCodes = pgTable("oauth_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull().unique(),
  clientId: text("client_id").notNull(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: apiScope("scope").notNull(),
  /** Added in 0005 (replaces spend_cap_usd): the credit ceiling the user chose on the consent screen. */
  maxCredits: integer("max_credits"),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Leads from the done-with-you service page. No email is sent from the app. */
export const serviceRequests = pgTable("service_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull().default(""),
  monthlyVideos: integer("monthly_videos").notNull().default(0),
  message: text("message").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
