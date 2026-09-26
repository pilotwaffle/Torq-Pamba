import Link from "next/link";
import { PageHeader, cardClass, fieldClass, primaryButton, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { createInviteAction, updateWorkspaceAction } from "@/lib/workspace-actions";
import { listMembers } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; invite?: string }>;
}) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const members = await listMembers(workspace.id);
  const inviteToken =
    typeof params.invite === "string" && /^[a-f0-9]{64}$/.test(params.invite) ? params.invite : null;

  return (
    <main className="max-w-xl">
      <PageHeader title="Settings" description="Workspace name, timezone, monthly budget, and who can join." />
      {params.error ? (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {params.error}
        </p>
      ) : null}
      {params.saved === "1" ? (
        <p className="mt-4 text-sm text-zinc-700" role="status">
          Saved.
        </p>
      ) : null}

      <form action={updateWorkspaceAction} className={`${cardClass} flex flex-col gap-4 p-5`}>
        <div className="flex flex-col gap-1">
          <label htmlFor="name">Workspace name</label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={workspace.name}
            className={fieldClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="timezone">Timezone</label>
          <input
            id="timezone"
            name="timezone"
            type="text"
            required
            defaultValue={workspace.timezone}
            className={fieldClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="budgetCapUsd">Monthly budget cap</label>
          <input
            id="budgetCapUsd"
            name="budgetCapUsd"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={workspace.budgetCapUsd}
            className={fieldClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="aiDisclosureDefault"
            name="aiDisclosureDefault"
            type="checkbox"
            defaultChecked={workspace.aiDisclosureDefault}
          />
          <label htmlFor="aiDisclosureDefault">AI disclosure default</label>
        </div>
        <p className="text-sm text-zinc-600">
          AI disclosure default is {workspace.aiDisclosureDefault ? "ON" : "OFF"}. Turning it off
          requires confirmation and is logged.
        </p>
        <div className="flex items-center gap-2">
          <input id="confirmDisableAiDisclosure" name="confirmDisableAiDisclosure" type="checkbox" />
          <label htmlFor="confirmDisableAiDisclosure">
            I confirm turning AI disclosure off
          </label>
        </div>
        <button type="submit" className={`${primaryButton} w-fit`}>
          Save settings
        </button>
      </form>

      <h2 className="mt-10 text-lg font-semibold">Members</h2>
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {members.map((member) => (
          <li key={member.id}>
            {member.email} ({member.role})
          </li>
        ))}
      </ul>

      <form action={createInviteAction} className="mt-6">
        <button type="submit" className={secondaryButton}>
          Create invite link
        </button>
      </form>
      {inviteToken ? (
        <p className="mt-3 text-sm">
          Invite link (expires in 14 days):{" "}
          <Link href={`/invite/${inviteToken}`} className="break-all underline">
            {`/invite/${inviteToken}`}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
