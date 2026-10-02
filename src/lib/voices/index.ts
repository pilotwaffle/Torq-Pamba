// What other features use from voices. See "Voices and lip-sync" in docs/ARCHITECTURE.md.
export {
  lipsyncLine,
  pollDueVoiceJobs,
  refreshLipsyncJob,
  speakLine,
  voiceTrackFromJob,
  type TalkingClip,
  type VoiceResolvers,
  type VoiceTrack,
} from "./pipeline";
export { getVoice, lipsyncModelFor, listVoices, resolveAvatarVoice, VoiceError } from "./store";
export type { LipsyncProvider, VoiceProvider } from "./types";
