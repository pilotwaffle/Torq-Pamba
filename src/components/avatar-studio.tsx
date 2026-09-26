"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { previewAvatarAction, useGeneratedAvatarAction, useStockAvatarAction } from "@/lib/avatars/actions";
import { shortlist, STOCK_AVATARS, voiceLabel, type StockAvatar } from "@/lib/avatars/catalog";
import { formatUsd, GROK_IMAGINE_IMAGE_USD } from "@/lib/pricing";
import { fieldClass as inputClass, primaryButton, secondaryButton } from "@/components/ui";

const primary = primaryButton;
const secondary = secondaryButton;

export type StudioAvatar = {
  id: string;
  name: string;
  look: string;
  voiceId: string;
  image: string | null;
  isDefault: boolean;
  scenes: { name: string; startFrame: string }[];
};

type Preview = {
  description: string;
  name: string;
  look: string;
  svg: string;
  voiceId: string;
};

export function AvatarStudio({
  niche,
  saved,
  returnTo,
}: {
  niche: string;
  saved: StudioAvatar[];
  returnTo: string;
}) {
  const matched = shortlist(niche);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-6 flex flex-col gap-10">
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {saved.length > 0 ? (
        <section aria-labelledby="your-avatars">
          <h2 id="your-avatars" className="text-lg font-semibold">
            Your avatars
          </h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            {saved.map((avatar) => (
              <li key={avatar.id} className="rounded-xl border border-zinc-200 bg-white shadow-sm p-3">
                <Portrait svg={markupFromImage(avatar.image) ?? ""} />
                <p className="mt-2 font-medium">{avatar.name}</p>
                {avatar.isDefault ? <p className="text-sm text-zinc-700">Default</p> : null}
                <p className="text-sm text-zinc-600">{avatar.look}</p>
                <p className="text-sm text-zinc-600">Voice: {voiceLabel(avatar.voiceId)}</p>
                <SceneRow scenes={avatar.scenes} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="matched-heading">
        <h2 id="matched-heading" className="text-lg font-semibold">
          Matched to your niche
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          {niche
            ? `Ranked from your niche, ${niche}.`
            : "Add a niche on the brand brief and the ranking will follow it."}
        </p>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {matched.map((avatar) => (
            <AvatarCard key={avatar.id} avatar={avatar} returnTo={returnTo} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="stock-heading">
        <h2 id="stock-heading" className="text-lg font-semibold">
          Stock avatars
        </h2>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STOCK_AVATARS.map((avatar) => (
            <AvatarCard key={avatar.id} avatar={avatar} returnTo={returnTo} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="generate-heading">
        <h2 id="generate-heading" className="text-lg font-semibold">
          Generate from description
        </h2>
        <form
          className="mt-3 flex max-w-xl flex-col gap-3"
          action={async (formData) => {
            const result = await previewAvatarAction(formData);
            if (!result.ok) {
              setPreview(null);
              setError(result.error);
              return;
            }
            setError(null);
            setPreview({
              description: String(formData.get("description") ?? ""),
              name: result.name,
              look: result.look,
              svg: result.svg,
              voiceId: result.voiceId,
            });
          }}
        >
          <label className="flex flex-col gap-1" htmlFor="avatar-description">
            Describe your avatar
            <textarea
              id="avatar-description"
              name="description"
              required
              rows={4}
              maxLength={500}
              className={inputClass}
            />
          </label>
          <p>{`Estimated cost: ${formatUsd(GROK_IMAGINE_IMAGE_USD)}`}</p>
          <GenerateButton />
        </form>
        {preview ? (
          <div className="mt-4 max-w-sm rounded-xl border border-zinc-200 bg-white shadow-sm p-3">
            <Portrait svg={preview.svg} />
            <p className="mt-2 font-medium">{preview.name}</p>
            <p className="text-sm text-zinc-600">{preview.look}</p>
            <p className="text-sm text-zinc-600">Voice: {voiceLabel(preview.voiceId)}</p>
            <form action={useGeneratedAvatarAction} className="mt-3">
              <input type="hidden" name="description" value={preview.description} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button type="submit" className={primary}>
                Use this avatar
              </button>
            </form>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function AvatarCard({ avatar, returnTo }: { avatar: StockAvatar; returnTo: string }) {
  return (
    <li className="flex flex-col rounded-xl border border-zinc-200 bg-white shadow-sm p-3">
      <Portrait svg={avatar.svg} />
      <p className="mt-2 font-medium">{avatar.name}</p>
      <p className="text-sm text-zinc-600">{avatar.look}</p>
      <p className="text-sm text-zinc-600">Voice: {voiceLabel(avatar.voiceId)}</p>
      <p className="text-sm text-zinc-600">Fits: {avatar.keywords.slice(0, 3).join(", ")}</p>
      <form action={useStockAvatarAction} className="mt-3">
        <input type="hidden" name="avatarId" value={avatar.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <button type="submit" className={secondary}>
          Use this avatar
        </button>
      </form>
    </li>
  );
}

function GenerateButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`${primary} w-fit`} disabled={pending}>
      Generate avatar
    </button>
  );
}

function Portrait({ svg }: { svg: string }) {
  if (!svg.startsWith("<svg")) return null;
  return (
    <div className="h-40 w-32 [&_svg]:h-full [&_svg]:w-full" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

function SceneRow({ scenes }: { scenes: { name: string; startFrame: string }[] }) {
  if (scenes.length === 0) return null;
  return (
    <ul className="mt-3 flex gap-2">
      {scenes.map((scene) => {
        const svg = markupFromImage(scene.startFrame);
        return (
          <li key={scene.name} className="w-24">
            {svg ? (
              <div
                className="h-14 overflow-hidden rounded border border-zinc-200 [&_svg]:h-full [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : null}
            <p className="mt-1 text-xs text-zinc-600">{scene.name}</p>
          </li>
        );
      })}
    </ul>
  );
}

function markupFromImage(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("<svg")) return value;
  const marker = "data:image/svg+xml;charset=utf-8,";
  if (!value.startsWith(marker)) return null;
  try {
    const svg = decodeURIComponent(value.slice(marker.length));
    return svg.startsWith("<svg") ? svg : null;
  } catch {
    return null;
  }
}
