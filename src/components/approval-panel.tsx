"use client";

import { useState } from "react";
import { approveAction } from "@/lib/approval-actions";
import { canApprove, PRIVACY_OPTIONS, type ApprovalDraft, type Privacy } from "@/lib/approval";
import { cardClass, fieldClass, primaryButton } from "@/components/ui";

export function ApprovalPanel({
  videoId,
  aiDefault,
}: {
  videoId: string;
  aiDefault: boolean;
}) {
  const [draft, setDraft] = useState<ApprovalDraft>({
    creatorNickname: "",
    privacy: "",
    allowComments: false,
    allowDuet: false,
    allowStitch: false,
    commercialDisclosure: false,
    commercialType: "",
    aiGenerated: aiDefault,
    confirmAiOff: false,
    musicConsent: false,
    scheduleConsent: false,
  });
  const ready = canApprove(draft);

  function patch(partial: Partial<ApprovalDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  return (
    <form action={approveAction} className={`${cardClass} flex flex-col gap-5 p-4 sm:p-5`}>
      <input type="hidden" name="videoId" value={videoId} />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Privacy</legend>
        <div className="mt-2 flex flex-col gap-1">
          <label htmlFor="creatorNickname" className="text-sm font-medium">
            Creator nickname
          </label>
          <input
            id="creatorNickname"
            name="creatorNickname"
            value={draft.creatorNickname}
            onChange={(event) => patch({ creatorNickname: event.target.value })}
            className={fieldClass}
            autoComplete="nickname"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="privacy" className="text-sm font-medium">
            Who can view this video
          </label>
          <select
            id="privacy"
            name="privacy"
            value={draft.privacy}
            onChange={(event) => patch({ privacy: event.target.value as "" | Privacy })}
            className={fieldClass}
          >
            <option value="">Select…</option>
            {PRIVACY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2 border-t border-zinc-100 pt-4">
        <legend className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Interactions</legend>
        <div className="mt-2 flex flex-col gap-2">
          <Toggle
            name="allowComments"
            label="Allow comments"
            checked={draft.allowComments}
            onChange={(allowComments) => patch({ allowComments })}
          />
          <Toggle name="allowDuet" label="Allow duet" checked={draft.allowDuet} onChange={(allowDuet) => patch({ allowDuet })} />
          <Toggle
            name="allowStitch"
            label="Allow stitch"
            checked={draft.allowStitch}
            onChange={(allowStitch) => patch({ allowStitch })}
          />
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2 border-t border-zinc-100 pt-4">
        <legend className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Disclosure</legend>
        <div className="mt-2 flex flex-col gap-2">
          <Toggle
            name="commercialDisclosure"
            label="Commercial content disclosure"
            checked={draft.commercialDisclosure}
            onChange={(commercialDisclosure) =>
              patch({ commercialDisclosure, commercialType: commercialDisclosure ? draft.commercialType : "" })
            }
          />
          {draft.commercialDisclosure ? (
            <fieldset className="flex flex-col gap-2 ps-1">
              <legend className="text-sm">Commercial content</legend>
              <Radio
                name="commercialType"
                value="your_brand"
                label="Your brand"
                checked={draft.commercialType === "your_brand"}
                onChange={() => patch({ commercialType: "your_brand" })}
              />
              <Radio
                name="commercialType"
                value="branded_content"
                label="Branded content"
                checked={draft.commercialType === "branded_content"}
                onChange={() => patch({ commercialType: "branded_content" })}
              />
            </fieldset>
          ) : null}
          <Toggle
            name="aiGenerated"
            label="AI-generated content label"
            checked={draft.aiGenerated}
            onChange={(aiGenerated) => patch({ aiGenerated, confirmAiOff: aiGenerated ? false : draft.confirmAiOff })}
          />
          {!draft.aiGenerated ? (
            <Toggle
              name="confirmAiOff"
              label="I confirm turning off the AI-generated label"
              checked={draft.confirmAiOff}
              onChange={(confirmAiOff) => patch({ confirmAiOff })}
            />
          ) : null}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2 border-t border-zinc-100 pt-4">
        <legend className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Consent</legend>
        <div className="mt-2 flex flex-col gap-2">
          <Toggle
            name="musicConsent"
            label="I agree to TikTok's Music Usage Confirmation"
            checked={draft.musicConsent}
            onChange={(musicConsent) => patch({ musicConsent })}
          />
          <Toggle
            name="scheduleConsent"
            label="I consent to schedule this video"
            checked={draft.scheduleConsent}
            onChange={(scheduleConsent) => patch({ scheduleConsent })}
          />
        </div>
      </fieldset>
      <button type="submit" disabled={!ready} className={`${primaryButton} w-fit`}>
        Approve
      </button>
    </form>
  );
}

function Toggle({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        value="on"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 accent-emerald-700"
      />
      {label}
    </label>
  );
}

function Radio({
  name,
  value,
  label,
  checked,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="accent-emerald-700" />
      {label}
    </label>
  );
}
