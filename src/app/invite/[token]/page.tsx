import { redirect } from "next/navigation";
import { PublicHeader } from "@/components/public-chrome";
import { safeNext } from "@/lib/auth/redirects";
import { readSession } from "@/lib/auth/session";
import { acceptInvite, WorkspaceError } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await readSession();
  if (!session) {
    const nextPath = safeNext(`/invite/${token}`);
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  try {
    await acceptInvite(token, session.user.id);
  } catch (error) {
    if (!(error instanceof WorkspaceError)) throw error;
    const message = error.message;
    return (
      <div className="min-h-screen">
        <PublicHeader />
        <main className="mx-auto max-w-md px-6 py-12">
          <h1 className="text-2xl font-semibold">Invite</h1>
          <p className="mt-4 text-sm text-red-700" role="alert">
            {message}
          </p>
        </main>
      </div>
    );
  }

  redirect("/app");
}
