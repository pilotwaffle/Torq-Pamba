import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { money } from "./columns";
import { chatMessages, users, workspaces } from "./core";
import { toolCallStatus } from "./enums";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull().default(""),
    model: text("model"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("conversations_workspace_idx").on(table.workspaceId, table.updatedAt)],
);

/**
 * A tool the agent asked to run, with its arguments and result. Tools that spend
 * money or credits wait in `awaiting_confirmation` until the user clicks.
 */
export const chatToolCalls = pgTable(
  "chat_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    /** The assistant message that requested the call. */
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    /** The message that carries the result back to the model, when there is one. */
    resultMessageId: uuid("result_message_id").references(() => chatMessages.id, { onDelete: "set null" }),
    /** The model's id for this call (e.g. Anthropic `tool_use.id`). */
    callId: text("call_id"),
    toolName: text("tool_name").notNull(),
    arguments: jsonb("arguments").$type<Record<string, unknown>>().notNull().default({}),
    status: toolCallStatus("status").notNull().default("pending"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    costUsd: money("cost_usd").notNull().default(0),
    credits: integer("credits").notNull().default(0),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_tool_calls_message_idx").on(table.messageId),
    index("chat_tool_calls_workspace_idx").on(table.workspaceId, table.status, table.createdAt),
  ],
);
