import { isLive, postJson } from "./live";
import { defineAdapter, type LlmProvider } from "./types";

export function buildClaudeRequest(system: string, user: string) {
  return { model: "claude-sonnet-5", max_tokens: 2000, system, messages: [{ role: "user", content: user }] };
}

export function buildGrokChatRequest(system: string, user: string) {
  return {
    model: "grok-4.7",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
}

export function buildGeminiChatRequest(system: string, user: string) {
  return {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
  };
}

async function completeClaude(system: string, user: string): Promise<string> {
  const json = (await postJson(
    "claude-sonnet-5",
    "https://api.anthropic.com/v1/messages",
    buildClaudeRequest(system, user),
    {
      "x-api-key": process.env.ANTHROPIC_API_KEY?.trim() ?? "",
      "anthropic-version": "2023-06-01",
    },
  )) as { content?: { text?: string }[] };
  return json.content?.map((part) => part.text ?? "").join("\n") ?? "";
}

async function completeGrok(system: string, user: string): Promise<string> {
  const json = (await postJson(
    "grok-4.7",
    "https://api.x.ai/v1/chat/completions",
    buildGrokChatRequest(system, user),
    { authorization: `Bearer ${process.env.XAI_API_KEY?.trim() ?? ""}` },
  )) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

async function completeGemini(system: string, user: string): Promise<string> {
  const json = (await postJson(
    "gemini-3.8-flash",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    buildGeminiChatRequest(system, user),
    { "x-goog-api-key": process.env.GEMINI_API_KEY?.trim() ?? "" },
  )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
}

export const claudeSonnet: LlmProvider = {
  id: "claude-sonnet-5",
  vendor: "anthropic",
  label: "Claude Sonnet 5",
  complete({ system, user }) {
    return completeClaude(system, user);
  },
};

export const grokChat: LlmProvider = {
  id: "grok-4.7",
  vendor: "xai",
  label: "Grok 4.7",
  complete({ system, user }) {
    return completeGrok(system, user);
  },
};

export const geminiChat: LlmProvider = {
  id: "gemini-3.8-flash",
  vendor: "google",
  label: "Gemini 3.8 Flash",
  complete({ system, user }) {
    return completeGemini(system, user);
  },
};

export const adapter = defineAdapter({ id: "llm", llm: [claudeSonnet, grokChat, geminiChat] });

/** Live chat model, or null when PROVIDER_MODE is not live or no key is set. */
export async function completeLive(system: string, user: string): Promise<string | null> {
  if (isLive(["ANTHROPIC_API_KEY"])) return claudeSonnet.complete({ system, user });
  if (isLive(["XAI_API_KEY"])) return grokChat.complete({ system, user });
  if (isLive(["GEMINI_API_KEY"])) return geminiChat.complete({ system, user });
  return null;
}
