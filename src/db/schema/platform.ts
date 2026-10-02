import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

// ---------------------------------------------------------------------------
// Phase 4 platform (ported from feat/phase2-plus): REST v1, the MCP server and
// its OAuth 2.1 authorization server, and done-with-you leads. These tables
// back the implemented API. They predate the wave-0 `api_keys` placeholder
// above, which stays untouched; consolidating the two is an owner decision.
// ---------------------------------------------------------------------------

/**
 * Every machine credential: workspace API keys and OAuth access/refresh tokens.
 * Only a SHA-256 hash of the secret is stored. grant_id groups one OAuth grant's
 * rotating tokens (for keys it is the key's own id) and is what the spend cap counts.
 */
export const apiCredentials = pgTable(
  "api_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: apiCredentialKind("kind").notNull(),
    name: text("name").notNull().default(""),
    prefix: text("prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    scope: apiScope("scope").notNull().default("read"),
    grantId: uuid("grant_id").notNull(),
    clientId: text("client_id"),
    /** Monthly cap on generation spend through this key or grant. Null = workspace budget only. */
    spendCapUsd: money("spend_cap_usd"),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("api_credentials_hash_idx").on(table.secretHash),
    index("api_credentials_workspace_idx").on(table.workspaceId, table.kind),
    index("api_credentials_grant_idx").on(table.grantId),
  ],
);

/** One row per authenticated API or MCP call. cost_usd is non-zero only for a successful generation. */
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
  spendCapUsd: money("spend_cap_usd"),
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
