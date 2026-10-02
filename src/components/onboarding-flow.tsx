"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { BriefValues } from "@/components/brief-fields";
import { BriefFields } from "@/components/brief-fields";
import { AvatarStudio, type StudioAvatar } from "@/components/avatar-studio";
import {
  analyzeWebsiteAction,
  confirmBriefAction,
  continueAvatarAction,
  finishOnboardingAction,
  mediaAction,
  saveExtractedBriefAction,
  saveManualBriefAction,
  type AnalyzeResult,
} from "@/lib/onboarding/actions";
import { canUseAssetInVideo } from "@/lib/onboarding/rights";
import { PageHeader, fieldClass, primaryButton } from "@/components/ui";

const primary = primaryButton;
const inputClass = fieldClass;

const STEPS = ["Website", "Brand", "Media", "Avatar", "Connect accounts"] as const;

export type OnboardingAsset = {
  id: string;
  url: string;
  sourceSnippet: string | null;
  rightsConfirmed: boolean;
};

export function OnboardingFlow({
  step,
  brief,
  assets,
  avatars,
  manual,
  initialError,
}: {
  step: number;
  brief: BriefValues;
  assets: OnboardingAsset[];
  avatars: StudioAvatar[];
  manual: boolean;
  initialError: string | null;
}) {
  const [error, setError] = useState(initialError);
  const [analysis, setAnalysis] = useState<Extract<AnalyzeResult, { ok: true }> | null>(null);
  const current = Math.min(5, Math.max(1, step));

  return (
    <main className="max-w-6xl">
      <PageHeader
        title="Onboarding"
        description="Pull a brief from a public page, confirm it, then pick an avatar. Nothing is posted."
      />
      <ol className="-mt-2 mb-6 flex flex-wrap gap-2 text-sm">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const active = number === current;
          return (
            <li
              key={label}
              className={
                active
                  ? "rounded-full bg-emerald-700 px-3 py-1 font-medium text-white"
                  : "rounded-full bg-white px-3 py-1 text-zinc-500 ring-1 ring-zinc-200"
              }
              aria-current={active ? "step" : undefined}
            >
              {number}. {label}
            </li>
          );
        })}
      </ol>
      <h2 className="text-xl font-semibold">{STEPS[current - 1]}</h2>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {current === 1 ? (
        <WebsiteStep
          manual={manual}
          analysis={analysis}
          onError={setError}
          onAnalysis={setAnalysis}
        />
      ) : null}
      {current === 2 ? (
        <form action={confirmBriefAction} className="mt-6 flex max-w-xl flex-col gap-4">
          <BriefFields brief={brief} variant="confirm" />
          <button type="submit" className={`${primary} w-fit`}>
            Confirm brief
          </button>
        </form>
      ) : null}
      {current === 3 ? <MediaStep assets={assets} /> : null}
      {current === 4 ? (
        <div className="mt-6">
          <p>
            <Link href="/app/avatars" className="underline">
              Open the avatar page
            </Link>
          </p>
          <AvatarStudio niche={brief.niche ?? ""} saved={avatars} returnTo="/app/onboarding" />
          <form action={continueAvatarAction} className="mt-6">
            <button type="submit" className={primary}>
              Continue
            </button>
          </form>
        </div>
      ) : null}
      {current === 5 ? (
        <form action={finishOnboardingAction} className="mt-6 max-w-xl">
          <p>
            Connect the accounts you own through TikTok Login Kit, Instagram Business Login and Facebook Login for Business. No passwords, no devices.{" "}
            <Link href="/app/accounts" className="font-medium text-emerald-800 underline">
              Open connected accounts
            </Link>
          </p>
          <button type="submit" className={`${primary} mt-6`}>
            Finish onboarding
          </button>
        </form>
      ) : null}
    </main>
  );
}

function WebsiteStep({
  manual,
  analysis,
  onError,
  onAnalysis,
}: {
  manual: boolean;
  analysis: Extract<AnalyzeResult, { ok: true }> | null;
  onError: (message: string | null) => void;
  onAnalysis: (result: Extract<AnalyzeResult, { ok: true }> | null) => void;
}) {
  if (manual && !analysis) {
    return (
      <form action={saveManualBriefAction} className="mt-6 flex max-w-xl flex-col gap-4">
        <BriefFields brief={{}} variant="manual" />
        <button type="submit" className={`${primary} w-fit`}>
          Save brand brief
        </button>
        <Link href="/app/onboarding" className="text-sm underline">
          Analyze a website
        </Link>
      </form>
    );
  }

  return (
    <div className="mt-6">
      <form
        className="flex max-w-xl flex-col gap-4"
        action={async (formData) => {
          const result = await analyzeWebsiteAction(formData);
          if (!result.ok) {
            onAnalysis(null);
            onError(result.error);
            return;
          }
          onError(null);
          onAnalysis(result);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="websiteUrl">Website URL</label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            required
            placeholder="https://example.com"
            className={inputClass}
          />
        </div>
        <AnalyzeButton />
      </form>
      <p className="mt-3 text-sm">
        <Link href="/app/onboarding?manual=1" className="underline">
          No website? Skip
        </Link>
      </p>
      {analysis ? <ExtractionTable analysis={analysis} /> : null}
    </div>
  );
}

function AnalyzeButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`${primary} w-fit`} disabled={pending}>
      Analyze website
    </button>
  );
}

function ExtractionTable({ analysis }: { analysis: Extract<AnalyzeResult, { ok: true }> }) {
  const { extraction, websiteUrl } = analysis;
  const products = extraction.products.map((product) => product.value).join("\n");
  const productSource = extraction.products.map((product) => product.source).join("\n") || "not found";
  const rows: { label: string; name: string; value: string; source: string; multiline?: boolean }[] = [
    { label: "Company name", name: "companyName", value: extraction.companyName.value, source: extraction.companyName.source },
    { label: "What they do", name: "whatTheyDo", value: extraction.whatTheyDo.value, source: extraction.whatTheyDo.source, multiline: true },
    { label: "Products", name: "products", value: products, source: productSource, multiline: true },
    { label: "Audience", name: "audience", value: extraction.audience.value, source: extraction.audience.source },
    { label: "Tone", name: "tone", value: extraction.tone.value, source: extraction.tone.source },
    { label: "Logo URL", name: "logoUrl", value: extraction.logoUrl.value, source: extraction.logoUrl.source },
  ];

  return (
    <form key={websiteUrl} action={saveExtractedBriefAction} className="mt-8">
      <input type="hidden" name="websiteUrl" value={websiteUrl} />
      <input type="hidden" name="imagesJson" value={JSON.stringify(extraction.images)} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] table-fixed border-collapse text-left text-sm">
          <caption className="mb-3 text-left text-base font-medium">Review the extraction</caption>
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[48%]" />
            <col className="w-[36%]" />
          </colgroup>
          <thead>
            <tr>
              <th className="border-b border-zinc-300 py-2 pr-3 font-medium">Field</th>
              <th className="border-b border-zinc-300 py-2 pr-3 font-medium">Extracted value</th>
              <th className="border-b border-zinc-300 py-2 font-medium">Source text</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="align-top">
                <th className="border-b border-zinc-200 py-3 pr-3 font-medium">{row.label}</th>
                <td className="border-b border-zinc-200 py-3 pr-3">
                  {row.multiline ? (
                    <textarea name={row.name} aria-label={row.label} rows={4} defaultValue={row.value} className={inputClass} />
                  ) : (
                    <input name={row.name} aria-label={row.label} type="text" defaultValue={row.value} className={inputClass} />
                  )}
                </td>
                <td className="border-b border-zinc-200 py-3">
                  <p className="line-clamp-3 font-mono text-xs leading-5 break-words text-zinc-500">{row.source}</p>
                </td>
              </tr>
            ))}
            {extraction.images.map((image) => (
              <tr key={image.value} className="align-top">
                <th className="border-b border-zinc-200 py-3 pr-3 font-medium">Image</th>
                <td className="border-b border-zinc-200 py-3 pr-3 break-all">{image.value}</td>
                <td className="border-b border-zinc-200 py-3">
                  <p className="line-clamp-3 font-mono text-xs leading-5 break-words text-zinc-500">{image.source}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="submit" className={`${primary} mt-4`}>
        Save brand brief
      </button>
    </form>
  );
}

function MediaStep({ assets }: { assets: OnboardingAsset[] }) {
  return (
    <form action={mediaAction} className="mt-6 flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-zinc-700">
        Confirm rights on the images you want in videos. Unconfirmed images stay in the library and cannot be
        used in videos.
      </p>
      {assets.length === 0 ? <p>No images yet. Add one by URL.</p> : null}
      <ul className="flex flex-col gap-3">
        {assets.map((asset) => (
          <li key={asset.id} className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center">
            {/* The browser loads this URL. Do not proxy arbitrary hosts through the image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.url} alt="" className="h-16 w-16 rounded object-contain" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{asset.url}</p>
              {asset.sourceSnippet ? <p className="truncate text-xs text-zinc-500">{asset.sourceSnippet}</p> : null}
              <p className="text-xs text-zinc-600">
                {canUseAssetInVideo(asset) ? "Available for videos" : "Not available for videos until rights are confirmed"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                id={`rights-${asset.id}`}
                type="checkbox"
                name="rights"
                value={asset.id}
                defaultChecked={asset.rightsConfirmed}
              />
              <label htmlFor={`rights-${asset.id}`}>I have the rights to use this</label>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1" htmlFor="imageUrl">
          Image URL
          <input id="imageUrl" name="imageUrl" type="text" inputMode="url" className={inputClass} />
        </label>
        <button type="submit" name="intent" value="add" className={primary}>
          Add image by URL
        </button>
      </div>
      <button type="submit" name="intent" value="continue" className={`${primary} w-fit`}>
        Continue
      </button>
    </form>
  );
}
