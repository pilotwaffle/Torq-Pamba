import { z } from "zod";
import { startCloneDraft } from "@/lib/voices/clone";
import { defineTool } from "./types";

/** Starts a clone that waits for samples and consent on the Avatars page. Never calls a voice provider. */
export const cloneVoiceTool = defineTool({
  name: "clone-voice",
  description:
    "Start a voice clone. It waits for the user to record or upload a sample and confirm the voice is theirs or that they have the speaker's permission; nothing is sent to a provider before that.",
  parameters: z.object({
    name: z.string().trim().min(1).max(60),
    speakerName: z.string().trim().max(80).optional(),
  }),
  priority: 24,
  match(text) {
    const theirs = text.match(/^(?:please\s+)?clone\s+(.+?)['’]s\s+voice$/i);
    if (theirs?.[1] && !/^(?:my|our)$/i.test(theirs[1])) {
      return { name: `${theirs[1]}’s voice`, speakerName: theirs[1] };
    }
    const mine = text.match(/^(?:please\s+)?clone\s+(?:my|our|a)\s+voice(?:\s+(?:as|called|named)\s+(.+))?$/i);
    if (mine) return { name: mine[1]?.trim() || "My voice" };
    return null;
  },
  async run(ctx, args) {
    const clone = await startCloneDraft({
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.userId,
      name: args.name,
      speakerName: args.speakerName,
    });
    await ctx.reply(
      `I started a voice clone called “${clone.name}”. To finish it, open Avatars → Voice clones, record or upload a sample, and confirm the voice is yours or that you have the speaker’s permission. Nothing is sent to a voice provider until you confirm.`,
      { kind: "voice-clone", cloneId: clone.id, status: clone.status },
    );
  },
});
