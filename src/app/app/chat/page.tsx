import { requireWorkspace } from "@/lib/auth/guards";
import { listChat } from "@/lib/agent/run";
import { ChatThread } from "@/components/chat-thread";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { workspace } = await requireWorkspace();
  const params = await searchParams;
  const rows = await listChat(workspace.id);
  const messages = rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    data: row.data ?? null,
  }));

  return (
    <main className="max-w-4xl">
      <PageHeader
        title="Chat"
        description="Plan a clip, see the price, then generate. Nothing is published until you approve it."
      />
      <ChatThread messages={messages} flashError={params.error} />
    </main>
  );
}
