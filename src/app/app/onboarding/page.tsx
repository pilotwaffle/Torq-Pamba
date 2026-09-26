import Link from "next/link";
import { OnboardingFlow } from "@/components/onboarding-flow";
import type { StudioAvatar } from "@/components/avatar-studio";
import { requireWorkspace } from "@/lib/auth/guards";
import { listWorkspaceAvatars } from "@/lib/avatars/store";
import { listAssets } from "@/lib/onboarding/assets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Onboarding" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; manual?: string }>;
}) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  if (workspace.onboardingStep >= 6) {
    return (
      <main className="max-w-xl">
        <h1 className="text-2xl font-semibold">Onboarding complete</h1>
        <p className="mt-3">You can edit the brand brief or choose another avatar any time.</p>
        <Link href="/app" className="mt-4 inline-block underline">
          Back to the dashboard
        </Link>
      </main>
    );
  }

  const [assetRows, avatarRows] = await Promise.all([
    listAssets(workspace.id),
    listWorkspaceAvatars(workspace.id),
  ]);
  const avatars: StudioAvatar[] = avatarRows.map((avatar) => ({
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
    <OnboardingFlow
      step={workspace.onboardingStep}
      brief={workspace.brief ?? {}}
      assets={assetRows.map((asset) => ({
        id: asset.id,
        url: asset.url,
        sourceSnippet: asset.sourceSnippet,
        rightsConfirmed: asset.rightsConfirmed,
      }))}
      avatars={avatars}
      manual={params.manual === "1"}
      initialError={params.error?.slice(0, 300) ?? null}
    />
  );
}
