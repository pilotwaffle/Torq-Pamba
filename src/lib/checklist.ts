import type { BrandBrief } from "@/db/schema";

export type ChecklistItem = {
  id: "brief" | "avatar" | "video" | "approve" | "connect";
  label: string;
  done: boolean;
  href: string;
};

export function zeroToFirstPost(input: {
  brief: BrandBrief | null | undefined;
  avatarCount: number;
  videoCount: number;
  hasApproval: boolean;
  connectedAccounts?: number;
}): ChecklistItem[] {
  const briefDone = Boolean(input.brief?.companyName?.trim() && input.brief?.niche?.trim());
  return [
    {
      id: "brief",
      label: "Brand brief",
      done: briefDone,
      href: briefDone ? "/app/brief" : "/app/onboarding",
    },
    { id: "avatar", label: "Avatar", done: input.avatarCount > 0, href: "/app/avatars" },
    { id: "video", label: "First video", done: input.videoCount > 0, href: "/app/chat" },
    {
      id: "approve",
      label: "Approve & schedule",
      done: input.hasApproval,
      href: "/app/schedule",
    },
    {
      id: "connect",
      label: "Connect accounts — Phase 2",
      done: (input.connectedAccounts ?? 0) > 0,
      href: "/app/accounts",
    },
  ];
}
