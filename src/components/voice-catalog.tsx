import type { VoiceOption } from "@/components/voice-controls";

export function VoiceCatalog({ voices, mock }: { voices: (VoiceOption & { accent: string | null })[]; mock: boolean }) {
  return (
    <section aria-labelledby="voice-catalog-heading" className="mt-10">
      <h2 id="voice-catalog-heading" className="text-lg font-semibold">
        Voice catalog
      </h2>
      <p className="mt-1 text-sm text-zinc-600">
        {mock
          ? "Mock voices: previews are generated tones that follow the words, not real speech. Add an ElevenLabs key and live mode for real voices."
          : "ElevenLabs voices. Previews are the vendor's hosted samples."}
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {voices.map((voice) => (
          <li key={voice.id} className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
            <p className="font-medium">
              {voice.name}
              {voice.kind === "clone" ? <span className="ml-2 text-xs font-normal text-emerald-800">Your clone</span> : null}
            </p>
            <p className="text-sm text-zinc-600">{[voice.description, voice.accent].filter(Boolean).join(" · ")}</p>
            <audio controls preload="none" src={`/api/voices/${voice.id}/preview`} aria-label={`Preview ${voice.name}`} className="w-full" />
          </li>
        ))}
      </ul>
    </section>
  );
}
