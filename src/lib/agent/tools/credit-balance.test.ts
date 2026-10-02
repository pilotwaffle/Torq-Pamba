import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleUserMessage, listChat } from "@/lib/agent/run";
import { signupAccount } from "@/lib/auth/account";
import { SIMULATED_STARTER_CREDITS } from "@/lib/credits/mode";
import { chatTools } from "./registry";

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("credit-balance chat tool", () => {
  it("matches balance questions and leaves video requests to the plan tool", () => {
    for (const text of ["how many credits do I have", "What's my credit balance", "credits", "check my balance", "balance left"]) {
      expect(chatTools.match(text)?.tool.name, text).toBe("credit-balance");
    }
    expect(chatTools.match("make a 30s video about credit cards")?.tool.name).toBe("plan");
    expect(chatTools.match("what's scheduled")?.tool.name).toBe("list-schedule");
    expect(chatTools.definitions().find((definition) => definition.name === "credit-balance")?.inputSchema).toMatchObject({
      type: "object",
    });
  });

  it("replies with the balance, the plan and the price of a standard video", async () => {
    const { user, workspace } = await signupAccount({
      email: `credit-tool-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      password: "correct-horse-battery",
      workspaceName: "Credit Tool Co",
    });
    await handleUserMessage({ workspace, userId: user.id, text: "How many credits do I have?" });
    const reply = (await listChat(workspace.id)).at(-1);
    expect(reply?.content).toBe(
      `You have ${SIMULATED_STARTER_CREDITS.toLocaleString("en-US")} credits on the Free plan. A standard 30s video costs 500 credits.`,
    );
    expect(reply?.data).toMatchObject({ kind: "credits", balance: SIMULATED_STARTER_CREDITS, planId: "free", standardVideoCredits: 500 });
  });
});
