// Pure helpers, safe in client components.

export const MAX_CLONE_SAMPLES = 3;
export const MAX_SAMPLE_BYTES = 5 * 1024 * 1024;
export const MIN_SAMPLE_BYTES = 1024;

export type ConsentBasis = "self" | "permission";

/** The statement the user confirms. Stored verbatim on `voice_clones.consent_statement`. */
export function consentStatement(basis: ConsentBasis, speakerName: string): string {
  const speaker = speakerName.trim() || "the speaker";
  return basis === "self"
    ? `I confirm that the voice in these samples is my own (${speaker}), and I consent to an AI clone of it being created for this workspace.`
    : `I confirm that I have ${speaker}’s explicit permission and the rights to create an AI clone of their voice for this workspace.`;
}

/** Audio mime type from the file's leading bytes, or null when it is not a supported audio format. */
export function sniffAudio(bytes: Uint8Array): string | null {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length < 12) return null;
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (ascii(4, 4) === "ftyp") return "audio/mp4";
  return null;
}
