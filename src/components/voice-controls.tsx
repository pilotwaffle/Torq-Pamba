"use client";

import { useState, useTransition } from "react";
import { previewTalkingClipAction, refreshTalkingClipAction, setAvatarVoiceAction, type TalkingClipView } from "@/lib/voices/actions";
import { TalkingClipPlayer } from "@/components/talking-clip-player";
import { fieldClass, primaryButton, secondaryButton } from "@/components/ui";

export type VoiceOption = { id: string; name: string; kind: "stock" | "clone"; description: string | null };

export function AvatarVoiceControls({
  avatarId,
  avatarName,
  returnTo,
  voices,
  selectedVoiceId,
  lipsyncModels,
  selectedLipsync,
  previewEstimateUsd,
}: {
  avatarId: string;
  avatarName: string;
  returnTo: string;
  voices: VoiceOption[];
  selectedVoiceId: string;
  lipsyncModels: { id: string; label: string }[];
  selectedLipsync: string;
  previewEstimateUsd: number;
}) {
  const [voiceId, setVoiceId] = useState(selectedVoiceId);
  const [clip, setClip] = useState<TalkingClipView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const stock = voices.filter((voice) => voice.kind === "stock");
  const clones = voices.filter((voice) => voice.kind === "clone");
  const current = voices.find((voice) => voice.id === voiceId);
  const saved = voices.find((voice) => voice.id === selectedVoiceId);

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-zinc-100 pt-3">
      <p className="text-sm text-zinc-600">Voice: {saved?.name ?? "None"}</p>
      <form action={setAvatarVoiceAction} className="flex flex-col gap-2" aria-label={`Voice settings for ${avatarName}`}>
        <input type="hidden" name="avatarId" value={avatarId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="flex flex-col gap-1 text-sm" htmlFor={`voice-${avatarId}`}>
          Voice for {avatarName}
          <select
            id={`voice-${avatarId}`}
            name="voiceId"
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value)}
            className={fieldClass}
          >
            <optgroup label="Stock voices">
              {stock.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </optgroup>
            {clones.length > 0 ? (
              <optgroup label="Your voice clones">
                {clones.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        {current ? (
          <audio
            key={current.id}
            controls
            preload="none"
            src={`/api/voices/${current.id}/preview`}
            aria-label={`Preview ${current.name}`}
            className="w-full"
          />
        ) : null}
        <label className="flex flex-col gap-1 text-sm" htmlFor={`lipsync-${avatarId}`}>
          Lip-sync engine
          <select id={`lipsync-${avatarId}`} name="lipsyncModel" defaultValue={selectedLipsync} className={fieldClass}>
            {lipsyncModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${primaryButton} w-fit`}>
          Save voice
        </button>
      </form>
      <button
        type="button"
        className={`${secondaryButton} w-fit`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await previewTalkingClipAction(avatarId);
            if (!result.ok) {
              setClip(null);
              setError(result.error);
              return;
            }
            setError(null);
            setClip(result.clip);
          })
        }
      >
        {pending ? "Making talking clip…" : `Preview talking clip (est. $${previewEstimateUsd.toFixed(2)})`}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {clip ? (
        <div className="flex flex-col gap-2">
          <TalkingClipPlayer clip={clip} label={`${avatarName} talking clip`} />
          {clip.status === "running" ? (
            <button
              type="button"
              className={`${secondaryButton} w-fit`}
              onClick={() =>
                startTransition(async () => {
                  const result = await refreshTalkingClipAction(clip.jobId);
                  if (result.ok) setClip(result.clip);
                })
              }
            >
              Check again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
