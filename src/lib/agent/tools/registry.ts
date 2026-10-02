import { z } from "zod";
import * as all from "./all";
import type { ChatTool, ChatToolContext } from "./types";

export type { ChatTool, ChatToolContext } from "./types";
export { defineTool } from "./types";

export type ToolMatch = { tool: ChatTool; args: Record<string, unknown> };

export type ToolRegistry = ReturnType<typeof createToolRegistry>;

/** Orders tools by priority, then name. Throws on duplicate names. */
export function createToolRegistry(tools: readonly ChatTool[]) {
  const byName = new Map<string, ChatTool>();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`Duplicate chat tool ${tool.name}`);
    byName.set(tool.name, tool);
  }
  const ordered = [...tools].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  function match(text: string): ToolMatch | null {
    const cleaned = text.trim().replace(/[!?.]+$/g, "").trim();
    for (const tool of ordered) {
      const raw = tool.match(cleaned);
      if (raw == null) continue;
      const parsed = tool.parameters.safeParse(raw);
      if (parsed.success) return { tool, args: parsed.data as Record<string, unknown> };
    }
    return null;
  }

  async function run(name: string, ctx: ChatToolContext, args: unknown): Promise<void> {
    const tool = byName.get(name);
    if (!tool) throw new Error(`Unknown chat tool ${name}`);
    await tool.run(ctx, args);
  }

  /**
   * Tool definitions in the JSON Schema shape tool-calling LLM APIs accept. The
   * input side of each schema, so fields with a default are optional for the caller.
   */
  function definitions() {
    return ordered.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.parameters, { io: "input" }),
    }));
  }

  return { tools: ordered, get: (name: string) => byName.get(name), match, run, definitions };
}

export const chatTools = createToolRegistry(Object.values(all));
