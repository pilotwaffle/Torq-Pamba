"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { generateAction, sendMessageAction } from "@/lib/agent/actions";
import { isPlanMessage, isReadyMessage, type VideoPlan } from "@/lib/agent/plan";
import { FALLBACK_CHAIN, TIER_MODEL, estimateClipCost, formatUsd, type Tier } from "@/lib/pricing";
import { cardClass, fieldClass, primaryButton } from "@/components/ui";

export type ChatMessageView = {
  id: string;
  role: string;
  content: string;
  data: unknown;
};

export function ChatThread({ messages, flashError }: { messages: ChatMessageView[]; flashError?: string }) {
  return (
    <div className="flex flex-col gap-6">
      {flashError ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {flashError}
        </p>
      ) : null}
      <ol className="flex flex-col gap-4">
        {messages.map((message) => (
          <li
            key={message.id}
            className={`${cardClass} p-4 ${message.role === "user" ? "border-emerald-200" : "border-zinc-200"}`}
          >
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              {message.role === "user" ? "You" : "Assistant"}
            </p>
            <p className="mt-2 text-sm leading-6 break-words whitespace-pre-wrap">{message.content}</p>
            {isPlanMessage(message.data) ? <PlanCard messageId={message.id} plan={message.data.plan} /> : null}
            {isReadyMessage(message.data) ? (
              <ReadyCard videoId={message.data.videoId} attemptSummary={message.data.attemptSummary} />
            ) : null}
          </li>
        ))}
      </ol>
      <form action={sendMessageAction} className={`${cardClass} flex flex-col gap-3 p-4`}>
        <label htmlFor="message" className="text-sm font-medium">
          Message
        </label>
        <textarea id="message" name="message" required rows={3} className={fieldClass} />
        <SendButton />
      </form>
    </div>
  );
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${primaryButton} w-fit`}>
      Send
    </button>
  );
}

function PlanCard({ messageId, plan }: { messageId: string; plan: VideoPlan }) {
  const [tier, setTier] = useState<Tier>(plan.tier);
  const [state, action, pending] = useActionState(generateAction, { error: null });
  const cost = estimateClipCost({ tier, durationS: plan.durationS });
  const chain = FALLBACK_CHAIN[tier];

  return (
    <form action={action} className="mt-4 flex flex-col gap-5 border-t border-zinc-200 pt-4">
      <input type="hidden" name="messageId" value={messageId} />
      <section aria-label="Scenes">
        <h3 className="text-sm font-medium">Scenes</h3>
        <ol className="mt-2 flex flex-col gap-3">
          {plan.scenes.map((scene, index) => (
            <li key={`${scene.durationS}-${index}`} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-700 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <p className="text-sm font-medium">
                  Scene {index + 1} · {scene.durationS}s
                </p>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{scene.visual}</p>
              <p className="mt-1 text-sm leading-6">{scene.line}</p>
            </li>
          ))}
        </ol>
      </section>
      <fieldset>
        <legend className="text-sm font-medium">Text hook</legend>
        <div className="mt-2 flex flex-col gap-2">
          {plan.hooks.map((hook, index) => (
            <label
              key={hook}
              className="flex cursor-pointer items-start gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50"
            >
              <input type="radio" name="hook" value={index} defaultChecked={index === 0} className="mt-0.5 accent-emerald-700" />
              <span>{hook}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <h3 className="text-sm font-medium">Captions</h3>
        <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm leading-6 whitespace-pre-wrap text-zinc-700">
          {plan.captions}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`tier-${messageId}`} className="text-sm font-medium">
          Quality tier
        </label>
        <select
          id={`tier-${messageId}`}
          name="tier"
          value={tier}
          onChange={(event) => setTier(event.target.value as Tier)}
          className={`${fieldClass} max-w-xs`}
        >
          <option value="budget">Budget</option>
          <option value="standard">Standard (recommended)</option>
          <option value="premium">Premium</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200">
        <table className="w-full min-w-[18rem] text-sm">
          <caption className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left font-medium">Cost preview</caption>
          <tbody>
            <CostRow label="Script" amount={cost.script} />
            <CostRow label="Scene frames" amount={cost.frames} />
            <CostRow label="Video" amount={cost.video} />
            <CostRow label="Voice" amount={cost.voice} />
            <CostRow label="Total" amount={cost.total} emphasis />
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Model</span>
          <span className="rounded-full bg-emerald-700 px-2.5 py-0.5 text-xs font-medium text-white">{TIER_MODEL[tier]}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Fallback</span>
          {chain.map((model) => (
            <span key={model} className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200">
              {model}
            </span>
          ))}
        </div>
      </div>
      {plan.avatarName ? <p className="text-sm text-zinc-600">Avatar: {plan.avatarName}</p> : null}
      {state.error ? (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`${primaryButton} w-fit`}>
        {pending ? "Generating…" : `Generate (est. ${formatUsd(cost.total)})`}
      </button>
    </form>
  );
}

function CostRow({ label, amount, emphasis }: { label: string; amount: number; emphasis?: boolean }) {
  return (
    <tr className={emphasis ? "bg-emerald-50 text-base font-semibold text-emerald-950" : "border-b border-zinc-100"}>
      <th scope="row" className="px-3 py-2 text-left font-medium">
        {label}
      </th>
      <td className="px-3 py-2 text-right tabular-nums" aria-live={emphasis ? "polite" : undefined}>
        {formatUsd(amount)}
      </td>
    </tr>
  );
}

function ReadyCard({ videoId, attemptSummary }: { videoId: string; attemptSummary: string | null }) {
  return (
    <div className="mt-4 border-t border-zinc-200 pt-4">
      <h3 className="text-base font-semibold">Video ready</h3>
      {attemptSummary ? <p className="mt-2 text-sm text-zinc-700">{attemptSummary}</p> : null}
      <Link href={`/app/videos/${videoId}`} className="mt-3 inline-block text-sm font-medium text-emerald-800 underline-offset-2 hover:underline">
        Review & approve
      </Link>
    </div>
  );
}
