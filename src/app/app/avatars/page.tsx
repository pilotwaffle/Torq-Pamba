import { AvatarStudio, type StudioAvatar } from "@/components/avatar-studio";
import { PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { listWorkspaceAvatars } from "@/lib/avatars/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Avatars" };

export default async function AvatarsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const rows = await listWorkspaceAvatars(workspace.id);
  const saved: StudioAvatar[] = rows.map((avatar) => ({
    id: avatar.id,
    name: avatar.name,
    look: avatar.look,
    voiceId: avatar.voiceId,
    image: avatar.image,
    isDefault: avatar.isDefault,
    scenes: (avatar.scenes ?? []).flatMap((scene) =>
      scene.startFrame ? [{ name: scene.name ?? "scene", startFrame: scene.startFrame }] : [],
    ),
  }));

  return (
    <main className="max-w-5xl">
      <PageHeader
        title="Avatars"
        description="Stock, matched, or described. The one you use is saved for this workspace only, with kitchen, street, and desk start frames."
      />
      {params.error ? (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {params.error.slice(0, 300)}
        </p>
      ) : null}
      <AvatarStudio niche={workspace.brief?.niche ?? ""} saved={saved} returnTo="/app/avatars" />
    </main>
  );
}
