import type { z } from "zod";
import type { Workspace } from "@/db/schema";

export type ChatToolContext = {
  workspace: Workspace;
  userId: string;
  /** The user's message, trimmed and capped at 2,000 characters. */
  text: string;
  /** Stores an assistant message in this workspace's chat. */
  reply(content: string, data: Record<string, unknown>): Promise<void>;
};

type ToolSpec<S extends z.ZodType> = {
  /** Unique, kebab-case. Stored as the intent `type` and as `chat_tool_calls.tool_name`. */
  name: string;
  /** One sentence for a tool-calling model. */
  description: string;
  parameters: S;
  /** Deterministic matchers run in ascending priority; the first non-null match wins. */
  priority: number;
  /**
   * Keyless parser for mock mode and the no-LLM path. Receives the message with
   * trailing punctuation removed. Return the tool's arguments, or null.
   */
  match(text: string): z.input<S> | null;
  run(ctx: ChatToolContext, args: z.output<S>): Promise<void>;
};

/** A registered tool. `run` and `parse` validate arguments against `parameters`, whoever produced them. */
export type ChatTool = {
  name: string;
  description: string;
  parameters: z.ZodType;
  priority: number;
  match(text: string): unknown;
  parse(args: unknown): Record<string, unknown>;
  run(ctx: ChatToolContext, args: unknown): Promise<void>;
};

export function defineTool<S extends z.ZodType<Record<string, unknown>>>(spec: ToolSpec<S>): ChatTool {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    priority: spec.priority,
    match: (text) => spec.match(text),
    parse: (args) => spec.parameters.parse(args),
    run: (ctx, args) => spec.run(ctx, spec.parameters.parse(args)),
  };
}
