import Link from "next/link";
import { BriefFields } from "@/components/brief-fields";
import { PageHeader, cardClass, primaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { saveBriefPageAction } from "@/lib/onboarding/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Brand brief" };

export default async function BriefPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const brief = workspace.brief ?? {};

  return (
    <main className="max-w-xl">
      <PageHeader
        title="Brand brief"
        description="Company, niche, and the people the clips are for."
        eyebrow={
          <Link href="/app/onboarding" className="font-medium text-emerald-800 underline-offset-2 hover:underline">
            Back to onboarding
          </Link>
        }
      />
      {params.error ? (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {params.error.slice(0, 300)}
        </p>
      ) : null}
      {params.saved === "1" ? (
        <p className="mt-4 text-sm text-zinc-700" role="status">
          Saved.
        </p>
      ) : null}
      <form action={saveBriefPageAction} className={`${cardClass} flex flex-col gap-4 p-5`}>
        <BriefFields brief={brief} variant="edit" />
        <button type="submit" className={`${primaryButton} w-fit`}>
          Save brand brief
        </button>
      </form>
    </main>
  );
}
