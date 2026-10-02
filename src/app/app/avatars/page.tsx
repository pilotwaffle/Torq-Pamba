import { AvatarStudio, type StudioAvatar } from "@/components/avatar-studio";
import { PageHeader } from "@/components/ui";
import { VoiceCatalog } from "@/components/voice-catalog";
import { VoiceClonePanel } from "@/components/voice-clone-panel";
import { AvatarVoiceControls, type VoiceOption } from "@/components/voice-controls";
import { requireWorkspace } from "@/lib/auth/guards";
import { listWorkspaceAvatars } from "@/lib/avatars/store";
import { catalog } from "@/lib/models";
import { registry } from "@/lib/providers/registry";
import { listClones } from "@/lib/voices/clone";
import { estimateTalkingClipUsd, talkingPreviewLine } from "@/lib/voices/preview";
import { lipsyncModelFor, lipsyncModels, listVoices, resolveAvatarVoice } from "@/lib/voices/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Avatars" };

export default async function AvatarsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; cloned?: string; cloneError?: string }>;
}) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const [rows, voices, clones] = await Promise.all([
    listWorkspaceAvatars(workspace.id),
    listVoices(workspace.id),
    listClones(workspace.id),
  ]);
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

  const options: VoiceOption[] = voices.map((voice) => ({
    id: voice.id,
    name: voice.name,
    kind: voice.kind,
    description: voice.description,
  }));
  const engines = lipsyncModels();
  const extras = Object.fromEntries(
    await Promise.all(
      rows.map(async (avatar) => {
        const voice = await resolveAvatarVoice(workspace.id, avatar);
        const engine = lipsyncModelFor(avatar);
        return [
          avatar.id,
          <AvatarVoiceControls
            key={avatar.id}
            avatarId={avatar.id}
            avatarName={avatar.name}
            returnTo="/app/avatars"
            voices={options}
            selectedVoiceId={voice.id}
            lipsyncModels={engines}
            selectedLipsync={engine}
            previewEstimateUsd={estimateTalkingClipUsd(talkingPreviewLine(avatar.name), engine)}
          />,
        ] as const;
      }),
    ),
  );
  const mock = !registry.get("voice", catalog.voiceOver().id).isLive();

  return (
    <main className="max-w-5xl">
      <PageHeader
        title="Avatars"
        description="Stock, matched, or described. The one you use is saved for this workspace only, with kitchen, street, and desk start frames, a voice, and a lip-sync engine."
      />
      {params.error ? (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {params.error.slice(0, 300)}
        </p>
      ) : null}
      <AvatarStudio niche={workspace.brief?.niche ?? ""} saved={saved} returnTo="/app/avatars" avatarExtras={extras} />
      <VoiceCatalog
        mock={mock}
        voices={voices.map((voice) => ({
          id: voice.id,
          name: voice.name,
          kind: voice.kind,
          description: voice.description,
          accent: voice.accent,
        }))}
      />
      <VoiceClonePanel
        mock={mock}
        cloned={params.cloned}
        cloneError={params.cloneError}
        clones={clones.map((clone) => ({
          id: clone.id,
          name: clone.name,
          speakerName: clone.speakerName,
          status: clone.status,
          error: clone.error,
          sampleCount: clone.sampleCount,
        }))}
      />
    </main>
  );
}
