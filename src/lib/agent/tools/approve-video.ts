import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { videos } from "@/db/schema";
import { PRIVACY_OPTIONS, type ApprovalDraft } from "@/lib/approval";
import { approveVideo, getWorkspaceVideo } from "@/lib/videos";
import { defineTool } from "./types";

export const APPROVAL_ACKNOWLEDGEMENTS = [
  "I agree to TikTok's Music Usage Confirmation",
  "I consent to schedule this video",
];

const PRIVACY_WORDS: Record<string, "public" | "friends" | "only_me"> = {
  public: "public",
  friends: "friends",
  "only me": "only_me",
};

const parameters = z
  .object({
    videoId: z.uuid().optional().describe("Defaults to the newest video that is ready for review."),
    privacy: z.enum(["public", "friends", "only_me"]).describe("Who can view it. Ask the user; there is no default."),
    creatorNickname: z.string().trim().max(80).default(""),
    allowComments: z.boolean().default(false),
    allowDuet: z.boolean().default(false),
    allowStitch: z.boolean().default(false),
    commercialDisclosure: z.boolean().default(false).describe("True when the video promotes a brand."),
    commercialType: z.enum(["your_brand", "branded_content"]).optional(),
  })
  .refine((value) => !value.commercialDisclosure || value.commercialType, {
    message: "Choose your_brand or branded_content when commercialDisclosure is true",
    path: ["commercialType"],
  });

async function readyVideo(workspaceId: string, videoId?: string) {
  if (videoId) {
    const video = await getWorkspaceVideo(workspaceId, videoId);
    if (!video) throw new Error("That video was not found.");
    if (video.status !== "ready") throw new Error(`“${video.title || "Untitled"}” is ${video.status}; only a finished video can be approved.`);
    return video;
  }
  const db = await getDb();
  const [video] = await db
    .select()
    .from(videos)
    .where(and(eq(videos.workspaceId, workspaceId), eq(videos.status, "ready")))
    .orderBy(desc(videos.updatedAt))
    .limit(1);
  if (!video) throw new Error("No video is ready to approve. Generate one first.");
  return video;
}

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

export const approveVideoTool = defineTool({
  name: "approve-video",
  description:
    "Approve a finished video so it can be scheduled. Ask the user who can view it first; the interaction toggles default to off and the AI-generated label always stays on (turning it off is only possible on the review page). The chat shows a confirmation card where the user ticks the music-usage and scheduling consents themselves; nothing is approved until they confirm. Approval never publishes.",
  parameters,
  priority: 50,
  match(text) {
    const found = text.match(/^approve (?:it|this|the video)\s+(?:as|for)\s+(public|friends|only me)$/i);
    const privacy = found?.[1] ? PRIVACY_WORDS[found[1].toLowerCase()] : undefined;
    return privacy ? { privacy } : null;
  },
  async confirm(ctx, args) {
    const video = await readyVideo(ctx.workspace.id, args.videoId);
    const privacy = PRIVACY_OPTIONS.find((option) => option.value === args.privacy)?.label ?? args.privacy;
    const commercial = args.commercialDisclosure
      ? args.commercialType === "branded_content"
        ? "Branded content"
        : "Your brand"
      : "None";
    return {
      title: `Approve “${video.title || "Untitled"}”`,
      lines: [
        `Who can view: ${privacy}`,
        `Comments ${onOff(args.allowComments)} · Duet ${onOff(args.allowDuet)} · Stitch ${onOff(args.allowStitch)}`,
        `Commercial content: ${commercial}`,
        "AI-generated label: on",
        "Approving does not publish anything.",
      ],
      acknowledgements: APPROVAL_ACKNOWLEDGEMENTS,
      confirmLabel: "Approve video",
      args: { ...args, videoId: video.id },
    };
  },
  async run(ctx, args) {
    const video = await readyVideo(ctx.workspace.id, args.videoId);
    // The consents are true because the agent runs this only after the user ticked both in the chat.
    const draft: ApprovalDraft = {
      creatorNickname: args.creatorNickname,
      privacy: args.privacy,
      allowComments: args.allowComments,
      allowDuet: args.allowDuet,
      allowStitch: args.allowStitch,
      commercialDisclosure: args.commercialDisclosure,
      commercialType: args.commercialDisclosure ? (args.commercialType ?? "") : "",
      aiGenerated: true,
      confirmAiOff: false,
      musicConsent: true,
      scheduleConsent: true,
    };
    await approveVideo({ workspace: ctx.workspace, actor: ctx.userId, videoId: video.id, draft });
    const privacy = PRIVACY_OPTIONS.find((option) => option.value === args.privacy)?.label ?? args.privacy;
    await ctx.reply(`Approved “${video.title || "Untitled"}”. Who can view: ${privacy}. It can be scheduled now.`, {
      kind: "approved",
      videoId: video.id,
    });
  },
});
