import type { Platform } from "./config";

/** The approval gate's privacy values (see src/lib/approval.ts). */
export type ApprovalPrivacy = "public" | "friends" | "only_me" | "";

export type TikTokPrivacy = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

export class PublishRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishRuleError";
  }
}

export type ApprovalRecord = {
  creatorNickname?: unknown;
  privacy?: unknown;
  allowComments?: unknown;
  allowDuet?: unknown;
  allowStitch?: unknown;
  commercialDisclosure?: unknown;
  commercialType?: unknown;
  aiGenerated?: unknown;
  musicConsent?: unknown;
  scheduleConsent?: unknown;
  /** User id of whoever approved. Publishing needs it to be a workspace owner. */
  approvedBy?: unknown;
};

/** Express consent captured on the approval screen is required before any upload starts. */
export function assertPublishConsent(approval: ApprovalRecord | null | undefined): void {
  if (!approval || typeof approval !== "object") throw new PublishRuleError("This video has no approval on record.");
  if (approval.musicConsent !== true) throw new PublishRuleError("Music usage confirmation is missing from the approval.");
  if (approval.scheduleConsent !== true) throw new PublishRuleError("Consent to post is missing from the approval.");
  const privacy = String(approval.privacy ?? "");
  if (!privacy) throw new PublishRuleError("The approval has no privacy choice. Privacy has no default.");
}

/**
 * The owner must approve every post before it publishes. An approval with no
 * approver, or one given by a member who is not an owner of the workspace,
 * does not publish.
 */
export function assertOwnerApproval(approval: ApprovalRecord | null | undefined, ownerUserIds: string[]): void {
  const approvedBy = approval && typeof approval === "object" ? approval.approvedBy : undefined;
  if (typeof approvedBy !== "string" || !approvedBy) {
    throw new PublishRuleError("This post has no approval from the workspace owner on record. Nothing was sent.");
  }
  if (!ownerUserIds.includes(approvedBy)) {
    throw new PublishRuleError("Only the workspace owner can approve a post for publishing. Nothing was sent.");
  }
}

/**
 * Everything Torq-Pamba makes is AI-generated, so every publish carries the
 * platform's AI label. There is no opt-out on the publish path.
 */
export function assertAiDisclosure(aiDisclosure: boolean): asserts aiDisclosure is true {
  if (aiDisclosure !== true) {
    throw new PublishRuleError("Every Torq-Pamba post is AI-generated and must carry the platform's AI label. Nothing was sent.");
  }
}

export function tiktokPrivacy(privacy: string): TikTokPrivacy {
  if (privacy === "public") return "PUBLIC_TO_EVERYONE";
  if (privacy === "friends") return "MUTUAL_FOLLOW_FRIENDS";
  if (privacy === "only_me") return "SELF_ONLY";
  throw new PublishRuleError("Choose who can view this video before posting.");
}

/**
 * Privacy actually sent to TikTok. Unaudited API clients may only post SELF_ONLY
 * (TikTok content-sharing guidelines), so the approval's choice is narrowed
 * until TIKTOK_AUDITED=1. The creator's own allowed options are enforced too.
 */
export function effectiveTikTokPrivacy(input: {
  approvalPrivacy: string;
  audited: boolean;
  allowedOptions?: string[];
}): { privacy: TikTokPrivacy; forcedPrivate: boolean } {
  const chosen = tiktokPrivacy(input.approvalPrivacy);
  const privacy: TikTokPrivacy = input.audited ? chosen : "SELF_ONLY";
  if (input.allowedOptions && input.allowedOptions.length > 0 && !input.allowedOptions.includes(privacy)) {
    throw new PublishRuleError(`This TikTok account does not allow ${privacy} right now.`);
  }
  return { privacy, forcedPrivate: privacy !== chosen };
}

/** TikTok rejects branded content posted as SELF_ONLY. */
export function assertBrandedNotPrivate(approval: ApprovalRecord, privacy: string): void {
  const branded = approval.commercialDisclosure === true && approval.commercialType === "branded_content";
  if (branded && privacy === "SELF_ONLY") {
    throw new PublishRuleError(
      "TikTok does not allow branded content to be private. It cannot post until the TikTok audit lifts private-only mode.",
    );
  }
}

/** Instagram and Facebook Reels are public, so they need a "Public" approval. */
export function assertMetaPrivacy(platform: Platform, approvalPrivacy: string): void {
  if (platform === "tiktok") return;
  if (approvalPrivacy !== "public") {
    throw new PublishRuleError(
      `${platform === "instagram" ? "Instagram" : "Facebook"} Reels are public. This approval chose a narrower audience, so it was not posted. Re-approve with "Public" to post here.`,
    );
  }
}

/**
 * Unaudited TikTok clients may let at most 5 distinct creators post per 24 hours.
 * `recentAccountIds` are TikTok accounts that direct-posted through this client in the last 24 h.
 */
export function tiktokCapAllows(input: { accountId: string; recentAccountIds: string[]; audited: boolean; cap: number }): boolean {
  if (input.audited) return true;
  const distinct = new Set(input.recentAccountIds);
  if (distinct.has(input.accountId)) return true;
  return distinct.size < input.cap;
}

export function postCaption(input: { hook: string; title: string; captions: string[] }): string {
  const parts = [input.hook.trim(), ...input.captions.map((line) => line.trim())].filter(Boolean);
  const text = parts.length > 0 ? parts.join("\n") : input.title.trim();
  return text.slice(0, 2_200);
}
