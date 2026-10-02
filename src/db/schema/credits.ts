import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { chatToolCalls } from "./chat";
import { money } from "./columns";
import { users, videos, workspaces } from "./core";
import { sceneTakes } from "./editor";
import { chargeKind, chargeStatus, creditEntryKind, topUpStatus } from "./enums";
import { generationJobs } from "./media";

/**
 * Credit plans. Rows are seeded by migration 0001 (free, hobby, pro).
 * Stripe price ids stay in env vars, not here.
 */
export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    yearlyPriceCents: integer("yearly_price_cents"),
    monthlyCredits: integer("monthly_credits").notNull(),
    signupCredits: integer("signup_credits").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "plans_amounts_check",
      sql`${table.monthlyPriceCents} >= 0 AND ${table.monthlyCredits} >= 0 AND ${table.signupCredits} >= 0`,
    ),
  ],
);

/** Append-only. `delta` is positive for grants and top-ups, negative for charges. */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: creditEntryKind("kind").notNull(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    description: text("description").notNull().default(""),
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    topUpId: uuid("top_up_id").references((): AnyPgColumn => creditTopUps.id, { onDelete: "set null" }),
    chargeId: uuid("charge_id").references((): AnyPgColumn => creditCharges.id, { onDelete: "set null" }),
    /** e.g. `stripe:evt_…` or `grant:<workspace>:<period>`, so retries cannot double-grant. */
    idempotencyKey: text("idempotency_key").unique(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("credit_ledger_workspace_idx").on(table.workspaceId, table.createdAt),
    check("credit_ledger_delta_check", sql`${table.delta} <> 0`),
  ],
);

export const creditTopUps = pgTable(
  "credit_top_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    credits: integer("credits").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: topUpStatus("status").notNull().default("pending"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [
    index("credit_top_ups_workspace_idx").on(table.workspaceId, table.createdAt),
    check("credit_top_ups_amount_check", sql`${table.credits} > 0 AND ${table.amountCents} >= 0`),
  ],
);

/** What one generation step costs in credits. Reserved up front, captured on success, released on failure. */
export const creditCharges = pgTable(
  "credit_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: chargeKind("kind").notNull(),
    status: chargeStatus("status").notNull().default("reserved"),
    videoId: uuid("video_id").references(() => videos.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    takeId: uuid("take_id").references(() => sceneTakes.id, { onDelete: "set null" }),
    toolCallId: uuid("tool_call_id").references(() => chatToolCalls.id, { onDelete: "set null" }),
    model: text("model"),
    /** Seconds, images, or 1K characters, depending on `kind`. */
    units: numeric("units", { precision: 14, scale: 3, mode: "number" }).notNull().default(0),
    credits: integer("credits").notNull(),
    /** Our provider list-price cost for the same step. */
    costUsd: money("cost_usd").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    index("credit_charges_workspace_idx").on(table.workspaceId, table.createdAt),
    index("credit_charges_video_idx").on(table.videoId),
    index("credit_charges_job_idx").on(table.jobId),
    check("credit_charges_credits_check", sql`${table.credits} >= 0`),
  ],
);
