import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { scheduleItems, videos, type Workspace } from "@/db/schema";
import { listWorkspaceAvatars } from "@/lib/avatars/store";
import { monthlySpendUsd } from "@/lib/budget";
import { zeroToFirstPost } from "@/lib/checklist";
import { listAccounts } from "@/lib/publish/accounts";
import { roundCents } from "@/lib/pricing";

export async function loadDashboard(workspace: Workspace) {
  const db = await getDb();
  const [videoRows, scheduleRows, usedUsd, avatarRows, accountRows] = await Promise.all([
    db
      .select({
        id: videos.id,
        title: videos.title,
        status: videos.status,
        createdAt: videos.createdAt,
      })
      .from(videos)
      .where(eq(videos.workspaceId, workspace.id))
      .orderBy(desc(videos.createdAt)),
    db
      .select({ status: scheduleItems.status })
      .from(scheduleItems)
      .where(eq(scheduleItems.workspaceId, workspace.id)),
    monthlySpendUsd(workspace.id, workspace.timezone),
    listWorkspaceAvatars(workspace.id),
    listAccounts(workspace.id),
  ]);

  const remainingUsd = roundCents(Math.max(0, Number(workspace.budgetCapUsd) - usedUsd));
  const hasApproval =
    videoRows.some((video) => video.status === "approved" || video.status === "scheduled") ||
    scheduleRows.some((item) => item.status !== "canceled");

  return {
    checklist: zeroToFirstPost({
      brief: workspace.brief,
      avatarCount: avatarRows.length,
      videoCount: videoRows.length,
      hasApproval,
      connectedAccounts: accountRows.length,
    }),
    recentVideos: videoRows.slice(0, 5),
    videoCount: videoRows.length,
    scheduledCount: scheduleRows.filter((item) => item.status === "scheduled").length,
    usedUsd,
    remainingUsd,
    avatarCount: avatarRows.length,
  };
}
