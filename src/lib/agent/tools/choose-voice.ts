import { z } from "zod";
import { listWorkspaceAvatars } from "@/lib/avatars/store";
import { findVoiceByName, listVoices, setAvatarVoice, VoiceError } from "@/lib/voices/store";
import { defineTool } from "./types";

const name = z.string().trim().min(1).max(80);

/** Without `voice` it lists the voices; with it, it sets that voice on the avatar (default avatar when unnamed). */
export const chooseVoiceTool = defineTool({
  name: "choose-voice",
  description:
    "List the voices an avatar can speak with, or set an avatar's voice by name (stock voices and this workspace's clones). Costs nothing.",
  parameters: z.object({ voice: name.optional(), avatar: name.optional() }),
  priority: 22,
  match(text) {
    if (/^(?:list|show)(?: me)?(?: the| all| available| my)* voices$|^what voices\b/i.test(text)) return {};
    const giveMatch = text.match(/^give\s+(.+?)\s+(?:the\s+)?(.+?)\s+voice$/i);
    if (giveMatch?.[1] && giveMatch[2]) return { avatar: giveMatch[1], voice: giveMatch[2] };
    const possessive = text.match(/^(?:set|change)\s+(.+?)['’]s\s+voice\s+to\s+(?:the\s+)?(.+?)(?:\s+voice)?$/i);
    if (possessive?.[1] && possessive[2]) return { avatar: possessive[1], voice: possessive[2] };
    const setMatch = text.match(/^(?:set|change|switch)\s+(?:the\s+)?(?:avatar(?:['’]s)?\s+)?voice\s+to\s+(?:the\s+)?(.+?)(?:\s+voice)?$/i);
    if (setMatch?.[1]) return { voice: setMatch[1] };
    const useMatch = text.match(/^(?:use|choose|pick)\s+(?:the\s+)?(.+?)\s+voice(?:\s+for\s+(.+))?$/i);
    if (useMatch?.[1]) return useMatch[2] ? { voice: useMatch[1], avatar: useMatch[2] } : { voice: useMatch[1] };
    return null;
  },
  async run(ctx, args) {
    if (!args.voice) {
      const voices = await listVoices(ctx.workspace.id);
      const lines = voices.map((voice) => `${voice.name}${voice.kind === "clone" ? " (your clone)" : ""} — ${voice.description ?? ""}`.trim());
      await ctx.reply(`Voices you can use:\n${lines.join("\n")}\nSay “use the Warm alto voice” to pick one.`, {
        kind: "voices",
        count: voices.length,
      });
      return;
    }
    const voice = await findVoiceByName(ctx.workspace.id, args.voice);
    if (!voice) {
      await ctx.reply(`I couldn’t find a voice called “${args.voice}”. Say “list voices” to see them.`, { kind: "note" });
      return;
    }
    const avatars = await listWorkspaceAvatars(ctx.workspace.id);
    const wanted = args.avatar?.toLowerCase().replace(/^(?:the\s+)?avatar\s+/, "");
    const avatar = wanted
      ? avatars.find((item) => item.name.toLowerCase() === wanted || item.name.toLowerCase().split(" ")[0] === wanted)
      : (avatars.find((item) => item.isDefault) ?? avatars[0]);
    if (!avatar) {
      await ctx.reply(
        wanted ? `I couldn’t find an avatar called “${args.avatar}”.` : "Pick an avatar on the Avatars page first, then choose its voice.",
        { kind: "note" },
      );
      return;
    }
    try {
      await setAvatarVoice({ workspaceId: ctx.workspace.id, actorUserId: ctx.userId, avatarId: avatar.id, voiceId: voice.id });
    } catch (error) {
      if (!(error instanceof VoiceError)) throw error;
      await ctx.reply(error.message, { kind: "note" });
      return;
    }
    await ctx.reply(`${avatar.name} now speaks with ${voice.name}. Preview it on the Avatars page.`, {
      kind: "voice",
      avatarId: avatar.id,
      voiceId: voice.id,
    });
  },
});
