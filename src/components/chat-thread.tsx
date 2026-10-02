"use client";

import { useActionState, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { generateAction } from "@/lib/agent/actions";
import { isAgentStep, type AgentEvent, type ToolCallStatus } from "@/lib/agent/events";
import { isPlanMessage, isReadyMessage, type VideoPlan } from "@/lib/agent/plan";
import type { ToolConfirmation } from "@/lib/agent/tools/types";
import { FALLBACK_CHAIN, TIER_MODEL, estimateClipCost, formatUsd, type Tier } from "@/lib/pricing";
import { CreditQuote } from "@/components/credits/credit-quote";
import { cardClass, fieldClass, primaryButton, secondaryButton } from "@/components/ui";

export type ChatMessageView = {
  id: string;
  role: string;
  content: string;
  data: unknown;
};

export type ToolCallView = {
  id: string;
  messageId: string;
  name: string;
  status: ToolCallStatus;
  arguments: Record<string, unknown>;
  error: string | null;
  summary: string | null;
  confirmation: ToolConfirmation | null;
  costUsd: number;
};

type LiveCall = { id: string; name: string; status: ToolCallStatus; arguments: Record<string, unknown>; error?: string };
type LiveSegment = { kind: "text"; text: string } | { kind: "call"; id: string };
type LiveTurn = { userText: string | null; segments: LiveSegment[]; calls: Record<string, LiveCall> };

const STATUS_TEXT: Record<ToolCallStatus, string> = {
  pending: "Queued",
  awaiting_confirmation: "Needs your confirmation",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  rejected: "Declined",
};

const STATUS_TONE: Record<ToolCallStatus, string> = {
  pending: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  awaiting_confirmation: "bg-amber-50 text-amber-900 ring-amber-200",
  running: "bg-sky-50 text-sky-800 ring-sky-200",
  succeeded: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  failed: "bg-rose-50 text-rose-800 ring-rose-200",
  rejected: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

function applyEvent(turn: LiveTurn, event: AgentEvent): LiveTurn {
  if (event.type === "text") {
    const last = turn.segments.at(-1);
    const segments =
      last?.kind === "text"
        ? [...turn.segments.slice(0, -1), { kind: "text" as const, text: last.text + event.delta }]
        : [...turn.segments, { kind: "text" as const, text: event.delta }];
    return { ...turn, segments };
  }
  if (event.type === "tool_call") {
    return {
      ...turn,
      segments: [...turn.segments, { kind: "call", id: event.id }],
      calls: { ...turn.calls, [event.id]: { id: event.id, name: event.name, status: "pending", arguments: event.arguments } },
    };
  }
  if (event.type === "tool_status") {
    const existing = turn.calls[event.id];
    const call: LiveCall = existing
      ? { ...existing, status: event.status, error: event.error }
      : { id: event.id, name: event.name, status: event.status, arguments: {}, error: event.error };
    const segments = existing ? turn.segments : [...turn.segments, { kind: "call" as const, id: event.id }];
    return { ...turn, segments, calls: { ...turn.calls, [event.id]: call } };
  }
  return turn;
}

async function readEvents(response: Response, onEvent: (event: AgentEvent) => void): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as AgentEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as AgentEvent);
}

export function ChatThread({
  messages,
  toolCalls,
  conversationId,
  modelLabel,
  flashError,
}: {
  messages: ChatMessageView[];
  toolCalls: ToolCallView[];
  conversationId: string;
  modelLabel: string;
  flashError?: string;
}) {
  const router = useRouter();
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [error, setError] = useState<string | null>(flashError ?? null);
  const [draft, setDraft] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const busy = live !== null || refreshing;

  const callsByMessage = new Map<string, ToolCallView[]>();
  for (const call of toolCalls) {
    const list = callsByMessage.get(call.messageId) ?? [];
    list.push(call);
    callsByMessage.set(call.messageId, list);
  }

  async function runStream(url: string, body: Record<string, unknown>, userText: string | null) {
    setError(null);
    setLive({ userText, segments: [], calls: {} });
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? `The request failed (${response.status}).`);
      } else {
        await readEvents(response, (event) => {
          if (event.type === "error") setError(event.message);
          setLive((turn) => (turn ? applyEvent(turn, event) : turn));
        });
      }
    } catch {
      setError("The connection dropped. Reload to see what was saved.");
    }
    startRefresh(() => {
      router.refresh();
      setLive(null);
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void runStream("/api/chat", { text, conversationId }, text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  function resolve(toolCallId: string, decision: "confirm" | "reject", acknowledged: string[]) {
    if (busy) return;
    void runStream("/api/chat/confirm", { toolCallId, decision, acknowledged }, null);
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-zinc-500">
        Agent: <span className="font-medium text-zinc-700">{modelLabel}</span>
      </p>
      <ol className="flex flex-col gap-4">
        {messages.map((message) => {
          const calls = callsByMessage.get(message.id) ?? [];
          if (isAgentStep(message.data) && !message.content.trim()) {
            return calls.length ? (
              <li key={message.id}>
                <ToolCallList calls={calls} busy={busy} onResolve={resolve} />
              </li>
            ) : null;
          }
          return (
            <li
              key={message.id}
              className={`${cardClass} p-4 ${message.role === "user" ? "border-emerald-200" : "border-zinc-200"}`}
            >
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                {message.role === "user" ? "You" : "Assistant"}
              </p>
              <p className="mt-2 text-sm leading-6 break-words whitespace-pre-wrap">{message.content}</p>
              {calls.length ? (
                <div className="mt-3">
                  <ToolCallList calls={calls} busy={busy} onResolve={resolve} />
                </div>
              ) : null}
              {isPlanMessage(message.data) ? (
                <PlanCard messageId={message.id} conversationId={conversationId} plan={message.data.plan} />
              ) : null}
              {isReadyMessage(message.data) ? (
                <ReadyCard videoId={message.data.videoId} attemptSummary={message.data.attemptSummary} />
              ) : null}
            </li>
          );
        })}
        {live ? <LiveTurnView turn={live} /> : null}
      </ol>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      <form ref={formRef} onSubmit={onSubmit} className={`${cardClass} flex flex-col gap-3 p-4`}>
        <label htmlFor="message" className="text-sm font-medium">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          className={fieldClass}
        />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className={`${primaryButton} w-fit`}>
            Send
          </button>
          {busy ? (
            <span role="status" className="text-sm text-zinc-600">
              Working…
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function LiveTurnView({ turn }: { turn: LiveTurn }) {
  return (
    <>
      {turn.userText ? (
        <li className={`${cardClass} border-emerald-200 p-4`}>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">You</p>
          <p className="mt-2 text-sm leading-6 break-words whitespace-pre-wrap">{turn.userText}</p>
        </li>
      ) : null}
      <li className={`${cardClass} border-zinc-200 p-4`} aria-live="polite" aria-busy="true">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Assistant</p>
        <div className="mt-2 flex flex-col gap-2">
          {turn.segments.length === 0 ? <p className="text-sm text-zinc-500">Thinking…</p> : null}
          {turn.segments.map((segment, index) => {
            if (segment.kind === "text") {
              return (
                <p key={`text-${index}`} className="text-sm leading-6 break-words whitespace-pre-wrap">
                  {segment.text}
                </p>
              );
            }
            const call = turn.calls[segment.id];
            return call ? <ToolCallSummary key={call.id} name={call.name} status={call.status} error={call.error} /> : null;
          })}
        </div>
      </li>
    </>
  );
}

function ToolCallSummary({ name, status, error }: { name: string; status: ToolCallStatus; error?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-mono text-xs text-zinc-700">{name}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[status]}`}>
        {STATUS_TEXT[status]}
      </span>
      {error ? <span className="text-xs text-rose-700">{error}</span> : null}
    </div>
  );
}

function ToolCallList({
  calls,
  busy,
  onResolve,
}: {
  calls: ToolCallView[];
  busy: boolean;
  onResolve: (id: string, decision: "confirm" | "reject", acknowledged: string[]) => void;
}) {
  return (
    <ul aria-label="Tool calls" className="flex flex-col gap-2">
      {calls.map((call) => (
        <li key={call.id} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
          <details>
            <summary className="cursor-pointer list-none">
              <ToolCallSummary name={call.name} status={call.status} error={call.error} />
            </summary>
            {call.summary ? <p className="mt-2 text-xs text-zinc-600">{call.summary}</p> : null}
            <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs text-zinc-700">
              {JSON.stringify(call.arguments, null, 2)}
            </pre>
            {call.costUsd > 0 ? <p className="mt-1 text-xs text-zinc-600">Cost: {formatUsd(call.costUsd)}</p> : null}
          </details>
          {call.status === "awaiting_confirmation" && call.confirmation ? (
            <ConfirmCard call={call} confirmation={call.confirmation} busy={busy} onResolve={onResolve} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ConfirmCard({
  call,
  confirmation,
  busy,
  onResolve,
}: {
  call: ToolCallView;
  confirmation: ToolConfirmation;
  busy: boolean;
  onResolve: (id: string, decision: "confirm" | "reject", acknowledged: string[]) => void;
}) {
  const required = confirmation.acknowledgements ?? [];
  const [ticked, setTicked] = useState<string[]>([]);
  const ready = required.every((statement) => ticked.includes(statement));
  return (
    <section aria-label={confirmation.title} className="mt-3 flex flex-col gap-3 rounded-lg border border-amber-200 bg-white p-3">
      <h3 className="text-sm font-semibold">{confirmation.title}</h3>
      {confirmation.lines?.length ? (
        <ul className="flex flex-col gap-1 text-sm text-zinc-700">
          {confirmation.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {typeof confirmation.costUsd === "number" ? (
        <p className="text-sm font-medium">Estimated cost: {formatUsd(confirmation.costUsd)}</p>
      ) : null}
      {required.map((statement) => (
        <label key={statement} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 accent-emerald-700"
            checked={ticked.includes(statement)}
            onChange={(event) =>
              setTicked((list) => (event.target.checked ? [...list, statement] : list.filter((item) => item !== statement)))
            }
          />
          <span>{statement}</span>
        </label>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => onResolve(call.id, "confirm", ticked)}
          className={primaryButton}
        >
          {confirmation.confirmLabel ?? "Confirm"}
        </button>
        <button type="button" disabled={busy} onClick={() => onResolve(call.id, "reject", [])} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function PlanCard({ messageId, conversationId, plan }: { messageId: string; conversationId: string; plan: VideoPlan }) {
  const [tier, setTier] = useState<Tier>(plan.tier);
  const [state, action, pending] = useActionState(generateAction, { error: null });
  const cost = estimateClipCost({ tier, durationS: plan.durationS });
  const chain = FALLBACK_CHAIN[tier];

  return (
    <form action={action} className="mt-4 flex flex-col gap-5 border-t border-zinc-200 pt-4">
      <input type="hidden" name="messageId" value={messageId} />
      <input type="hidden" name="conversationId" value={conversationId} />
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
      <CreditQuote tier={tier} durationS={plan.durationS} />
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
      <GenerateButton pending={pending} total={cost.total} />
    </form>
  );
}

function GenerateButton({ pending, total }: { pending: boolean; total: number }) {
  const status = useFormStatus();
  const working = pending || status.pending;
  return (
    <button type="submit" disabled={working} className={`${primaryButton} w-fit`}>
      {working ? "Generating…" : `Generate (est. ${formatUsd(total)})`}
    </button>
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
