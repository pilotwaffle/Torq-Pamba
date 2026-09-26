export const PRIVACY_OPTIONS = [
  { value: "public", label: "Public" },
  { value: "friends", label: "Friends" },
  { value: "only_me", label: "Only me" },
] as const;

export type Privacy = (typeof PRIVACY_OPTIONS)[number]["value"];

export type ApprovalDraft = {
  creatorNickname: string;
  privacy: "" | Privacy;
  allowComments: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  commercialDisclosure: boolean;
  commercialType: "" | "your_brand" | "branded_content";
  aiGenerated: boolean;
  confirmAiOff: boolean;
  musicConsent: boolean;
  scheduleConsent: boolean;
};

export const EMPTY_APPROVAL: ApprovalDraft = {
  creatorNickname: "",
  privacy: "",
  allowComments: false,
  allowDuet: false,
  allowStitch: false,
  commercialDisclosure: false,
  commercialType: "",
  aiGenerated: true,
  confirmAiOff: false,
  musicConsent: false,
  scheduleConsent: false,
};

export function approvalErrors(draft: ApprovalDraft): string[] {
  const errors: string[] = [];
  if (!draft.privacy) errors.push("Choose who can view this video");
  if (!draft.musicConsent) errors.push("Music usage confirmation is required");
  if (!draft.scheduleConsent) errors.push("Consent to schedule this video is required");
  if (!draft.aiGenerated && !draft.confirmAiOff) errors.push("Confirm turning off the AI-generated label");
  if (draft.commercialDisclosure && !draft.commercialType) {
    errors.push("Choose Your brand or Branded content");
  }
  return errors;
}

export function canApprove(draft: ApprovalDraft): boolean {
  return approvalErrors(draft).length === 0;
}
