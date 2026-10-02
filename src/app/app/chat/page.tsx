import Link from "next/link";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/guards";
import { newConversationAction } from "@/lib/agent/actions";
import {
  currentConversation,
  getConversation,
  listConversationMessages,
  listConversations,
  listConversationToolCalls,
  type ToolCallRow,
} from "@/lib/agent/conversation";
import { resolveAgentModel } from "@/lib/agent/model";
import type { ToolConfirmation } from "@/lib/agent/tools/types";
import { ChatThread, type ToolCallView } from "@/components/chat-thread";
import { PageHeader, secondaryButton } from "@/components/ui";

export const dynamic = "force-dynamic";

function toolCallView(call: ToolCallRow): ToolCallView {
  const result = (call.result ?? {}) as { replies?: { text?: unknown }[]; confirmation?: ToolConfirmation };
  const first = result.replies?.[0]?.text;
  return {
    id: call.id,
    messageId: call.messageId,
    name: call.toolName,
    status: call.status,
    arguments: call.arguments,
    error: call.error,
    summary: typeof first === "string" ? (first.split("\n")[0] ?? null) : null,
    confirmation: result.confirmation ?? null,
    costUsd: Number(call.costUsd ?? 0),
  };
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; c?: string }>;
}) {
  const { user, workspace } = await requireWorkspace();
  const params = await searchParams;
  const requested = z.uuid().safeParse(params.c);
  const conversation =
    (requested.success ? await getConversation(workspace.id, requested.data) : null) ??
    (await currentConversation(workspace.id, user.id));
  const [rows, calls, threads] = await Promise.all([
    listConversationMessages(workspace.id, conversation.id),
    listConversationToolCalls(workspace.id, conversation.id),
    listConversations(workspace.id),
  ]);
  const messages = rows
    .filter((row) => !(row.role === "user" && !row.content.trim()))
    .map((row) => ({ id: row.id, role: row.role, content: row.content, data: row.data ?? null }));

  return (
    <main className="max-w-4xl">
      <PageHeader
        title="Chat"
        description="Ask the agent to write a script, price it, generate, approve, and schedule. Anything that spends waits for your confirmation. Torq-Pamba does not publish it."
      />
      <nav aria-label="Conversations" className="mb-6 flex flex-wrap items-center gap-2">
        {threads.map((thread) => (
          <Link
            key={thread.id}
            href={`/app/chat?c=${thread.id}`}
            aria-current={thread.id === conversation.id ? "page" : undefined}
            className="max-w-[16rem] truncate rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 aria-[current=page]:border-emerald-600 aria-[current=page]:bg-emerald-50 aria-[current=page]:text-emerald-900"
          >
            {thread.title || "New conversation"}
          </Link>
        ))}
        <form action={newConversationAction}>
          <button type="submit" className={`${secondaryButton} py-1`}>
            New chat
          </button>
        </form>
      </nav>
      <ChatThread
        key={conversation.id}
        messages={messages}
        toolCalls={calls.map(toolCallView)}
        conversationId={conversation.id}
        modelLabel={resolveAgentModel().label}
        flashError={params.error}
      />
    </main>
  );
}
