"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { revokeCloneAction } from "@/lib/voices/actions";
import { consentStatement, MAX_CLONE_SAMPLES, type ConsentBasis } from "@/lib/voices/consent";
import { fieldClass, primaryButton, secondaryButton } from "@/components/ui";

export type CloneRow = {
  id: string;
  name: string;
  speakerName: string;
  status: string;
  error: string | null;
  sampleCount: number;
};

const noSubscribe = () => () => {};

function browserCanRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

const STATUS: Record<string, string> = {
  awaiting_consent: "Waiting for a sample and consent",
  processing: "Cloning",
  ready: "Ready",
  failed: "Failed",
  revoked: "Revoked",
};

export function VoiceClonePanel({
  clones,
  cloned,
  cloneError,
  mock,
}: {
  clones: CloneRow[];
  cloned?: string;
  cloneError?: string;
  mock: boolean;
}) {
  const drafts = clones.filter((clone) => clone.status === "awaiting_consent");
  const [draftId, setDraftId] = useState(drafts[0]?.id ?? "");
  const draft = drafts.find((clone) => clone.id === draftId);
  const [name, setName] = useState(draft?.name ?? "");
  const [speaker, setSpeaker] = useState(draft?.speakerName ?? "");
  const [basis, setBasis] = useState<ConsentBasis>("self");
  const [consent, setConsent] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [recording, setRecording] = useState<{ url: string; seconds: number } | null>(null);
  const [recorderState, setRecorderState] = useState<"idle" | "recording">("idle");
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingInput = useRef<HTMLInputElement>(null);
  const startedAt = useRef(0);
  const canRecord = useSyncExternalStore(noSubscribe, browserCanRecord, () => true);

  useEffect(() => () => {
    if (recording) URL.revokeObjectURL(recording.url);
  }, [recording]);

  function chooseDraft(id: string) {
    setDraftId(id);
    const next = drafts.find((clone) => clone.id === id);
    setName(next?.name ?? "");
    setSpeaker(next?.speakerName ?? "");
  }

  async function startRecording() {
    setRecorderError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream);
      media.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const type = media.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type });
        const file = new File([blob], `recording.${type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm"}`, { type });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        if (recordingInput.current) recordingInput.current.files = transfer.files;
        setRecording({ url: URL.createObjectURL(blob), seconds: Math.round((Date.now() - startedAt.current) / 1000) });
        setRecorderState("idle");
      };
      recorder.current = media;
      startedAt.current = Date.now();
      media.start();
      setRecorderState("recording");
    } catch {
      setRecorderError("The microphone is not available. Allow access, or upload a recording instead.");
      setRecorderState("idle");
    }
  }

  const hasSample = fileCount > 0 || recording !== null;
  const statement = consentStatement(basis, speaker);

  return (
    <section id="voice-clones" aria-labelledby="voice-clones-heading" className="mt-10 max-w-3xl">
      <h2 id="voice-clones-heading" className="text-lg font-semibold">
        Voice clones
      </h2>
      <p className="mt-1 text-sm text-zinc-600">
        Clone a voice from a short recording. Only clone your own voice, or a voice you have the speaker’s explicit
        permission to use. Nothing is sent to a voice provider until you confirm consent.
        {mock ? " Mock mode: no audio leaves this app and the clone uses mock speech." : ""}
      </p>
      {cloned ? (
        <p role="status" className="mt-3 text-sm text-emerald-800">
          “{cloned}” is ready. Pick it as an avatar’s voice above.
        </p>
      ) : null}
      {cloneError ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {cloneError.slice(0, 300)}
        </p>
      ) : null}

      <form
        action="/api/voices/clones"
        method="post"
        encType="multipart/form-data"
        className="mt-4 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
        aria-label="Clone a voice"
      >
        {drafts.length > 0 ? (
          <label className="flex flex-col gap-1 text-sm" htmlFor="clone-draft">
            Clone request
            <select id="clone-draft" name="cloneId" value={draftId} onChange={(event) => chooseDraft(event.target.value)} className={fieldClass}>
              {drafts.map((clone) => (
                <option key={clone.id} value={clone.id}>
                  {clone.name} (from chat)
                </option>
              ))}
              <option value="">New clone</option>
            </select>
          </label>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm" htmlFor="clone-name">
            Voice name
            <input id="clone-name" name="name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="clone-speaker">
            Speaker’s name
            <input
              id="clone-speaker"
              name="speakerName"
              required
              maxLength={80}
              value={speaker}
              onChange={(event) => setSpeaker(event.target.value)}
              className={fieldClass}
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Whose voice is this?</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="basis" value="self" checked={basis === "self"} onChange={() => setBasis("self")} />
            This is my own voice
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="basis" value="permission" checked={basis === "permission"} onChange={() => setBasis("permission")} />
            Someone else’s voice, and I have their permission
          </label>
        </fieldset>

        <div className="flex flex-col gap-2 text-sm">
          <label className="flex flex-col gap-1" htmlFor="clone-samples">
            Upload samples (up to {MAX_CLONE_SAMPLES} files, 5 MB each)
            <input
              id="clone-samples"
              name="samples"
              type="file"
              accept="audio/*"
              multiple
              onChange={(event) => setFileCount(event.target.files?.length ?? 0)}
              className="text-sm"
            />
          </label>
          <input ref={recordingInput} type="file" name="recording" accept="audio/*" hidden tabIndex={-1} aria-hidden="true" />
          {!canRecord ? (
            <p className="text-zinc-600">This browser cannot record here. Upload a recording instead.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {recorderState === "recording" ? (
                <button type="button" className={secondaryButton} onClick={() => recorder.current?.stop()}>
                  Stop recording
                </button>
              ) : (
                <button type="button" className={secondaryButton} onClick={startRecording}>
                  {recording ? "Record again" : "Record a sample"}
                </button>
              )}
              {recorderState === "recording" ? <span role="status">Recording… read a few sentences in your normal voice.</span> : null}
              {recording ? (
                <>
                  <audio controls src={recording.url} aria-label="Your recording" />
                  <span className="text-zinc-600">{recording.seconds}s recorded</span>
                </>
              ) : null}
            </div>
          )}
          {recorderError ? (
            <p role="alert" className="text-red-700">
              {recorderError}
            </p>
          ) : null}
        </div>

        <label className="flex items-start gap-2 text-sm" htmlFor="clone-consent">
          <input
            id="clone-consent"
            name="consent"
            type="checkbox"
            required
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-1"
          />
          <span>{statement}</span>
        </label>
        <button type="submit" className={`${primaryButton} w-fit`} disabled={!consent || !hasSample || !name.trim() || !speaker.trim()}>
          Clone voice
        </button>
      </form>

      {clones.length > 0 ? (
        <table className="mt-4 w-full text-left text-sm" aria-label="Your voice clones">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-600">
              <th className="py-2 font-medium">Voice</th>
              <th className="py-2 font-medium">Speaker</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Samples</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {clones.map((clone) => (
              <tr key={clone.id} className="border-b border-zinc-100">
                <td className="py-2">{clone.name}</td>
                <td className="py-2">{clone.speakerName || "—"}</td>
                <td className="py-2">
                  {STATUS[clone.status] ?? clone.status}
                  {clone.status === "failed" && clone.error ? <span className="block text-xs text-red-700">{clone.error}</span> : null}
                </td>
                <td className="py-2">{clone.sampleCount}</td>
                <td className="py-2 text-right">
                  {clone.status !== "revoked" ? (
                    <form action={revokeCloneAction}>
                      <input type="hidden" name="cloneId" value={clone.id} />
                      <button type="submit" className={secondaryButton} aria-label={`Revoke ${clone.name}`}>
                        Revoke
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
