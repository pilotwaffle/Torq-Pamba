import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handleUserMessage, listChat } from "@/lib/agent/run";
import { signupAccount } from "@/lib/auth/account";
import { chatTools, createToolRegistry, defineTool, type ChatToolContext } from "./registry";

const echo = defineTool({
  name: "echo",
  description: "Repeat a word.",
  parameters: z.object({ word: z.string().min(1).max(10) }),
  priority: 5,
  match: (text) => {
    const found = text.match(/^echo (\S+)$/i);
    return found?.[1] ? { word: found[1] } : null;
  },
  run: async (ctx, args) => ctx.reply(args.word.toUpperCase(), { kind: "note" }),
});

function context(): ChatToolContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    replies,
    workspace: {} as ChatToolContext["workspace"],
    userId: "u",
    text: "",
    reply: async (content) => {
      replies.push(content);
    },
  };
}

describe("chat tool registry", () => {
  it("ships plan, schedule and list-schedule in priority order", () => {
    expect(chatTools.tools.map((tool) => tool.name)).toEqual(["list-schedule", "schedule", "plan"]);
  });

  it("plugs in a new tool without touching the others", async () => {
    const registry = createToolRegistry([...chatTools.tools, echo]);
    const found = registry.match("echo hello!");
    expect(found?.tool.name).toBe("echo");
    expect(found?.args).toEqual({ word: "hello" });
    expect(registry.match("what's scheduled")?.tool.name).toBe("list-schedule");
    expect(registry.match("make a 20s video about tea")?.args).toEqual({ count: 1, durationS: 20, topic: "tea" });

    const ctx = context();
    await registry.run("echo", ctx, { word: "hi" });
    expect(ctx.replies).toEqual(["HI"]);
  });

  it("validates arguments from any caller and skips matches that fail validation", async () => {
    const registry = createToolRegistry([echo]);
    expect(registry.match("echo waytoolongforthis")).toBeNull();
    await expect(registry.run("echo", context(), { word: 3 })).rejects.toThrow();
    await expect(registry.run("missing", context(), {})).rejects.toThrow("Unknown chat tool missing");
    expect(() => chatTools.get("plan")?.parse({ count: 0, durationS: 30, topic: "x" })).toThrow();
  });

  it("refuses duplicate names", () => {
    expect(() => createToolRegistry([echo, echo])).toThrow("Duplicate chat tool echo");
  });

  it("exposes JSON Schema definitions for a tool-calling model", () => {
    const plan = chatTools.definitions().find((definition) => definition.name === "plan");
    expect(plan?.description).toMatch(/plan/i);
    expect(plan?.inputSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["count", "durationS", "topic"]),
    });
  });

  it("falls back to the help text when no tool matches", async () => {
    const { user, workspace } = await signupAccount({
      email: `tools-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      password: "correct-horse-battery",
      workspaceName: "Tools Co",
    });
    const spy = vi.spyOn(chatTools, "match");
    await handleUserMessage({ workspace, userId: user.id, text: "hello there" });
    expect(spy).toHaveBeenCalledWith("hello there");
    spy.mockRestore();
    const messages = await listChat(workspace.id);
    expect(messages.at(-1)?.content).toMatch(/^I can plan a video/);
  });
});
