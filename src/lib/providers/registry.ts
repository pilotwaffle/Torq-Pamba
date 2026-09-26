import { heygenAvatar } from "./heygen";
import { klingAvatar } from "./kling";
import { claudeSonnet, geminiChat, grokChat } from "./llm";
import { omniFlash, veoLite, veoStandard } from "./google";
import { seedanceRunway } from "./runway";
import { ProviderUnavailableError, type ImageProvider, type LlmProvider, type VideoProvider } from "./types";
import { grokImagineImage, grokImagineVideo } from "./xai";

export const videoProviders: VideoProvider[] = [
  omniFlash,
  veoLite,
  veoStandard,
  seedanceRunway,
  grokImagineVideo,
  klingAvatar,
  heygenAvatar,
];

export const imageProviders: ImageProvider[] = [grokImagineImage];

export const llmProviders: LlmProvider[] = [claudeSonnet, grokChat, geminiChat];

export function videoProvider(id: string): VideoProvider {
  const found = videoProviders.find((provider) => provider.id === id);
  if (!found) throw new ProviderUnavailableError(id, "not registered");
  return found;
}
