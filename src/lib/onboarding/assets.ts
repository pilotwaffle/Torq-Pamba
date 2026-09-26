import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assets } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { OnboardingError } from "./errors";
import { assertFetchableUrl } from "./fetchSite";

export async function listAssets(workspaceId: string) {
  const db = await getDb();
  return db
    .select()
    .from(assets)
    .where(eq(assets.workspaceId, workspaceId))
    .orderBy(asc(assets.createdAt));
}

export async function importImageAssets(
  workspaceId: string,
  images: { url: string; sourceSnippet?: string }[],
) {
  const existing = await listAssets(workspaceId);
  const seen = new Set(existing.map((asset) => asset.url));
  const rows: {
    workspaceId: string;
    url: string;
    kind: string;
    sourceSnippet: string | null;
    rightsConfirmed: boolean;
  }[] = [];
  for (const image of images) {
    if (!image.url || seen.has(image.url) || rows.length >= 24) continue;
    seen.add(image.url);
    rows.push({
      workspaceId,
      url: image.url,
      kind: "image",
      sourceSnippet: image.sourceSnippet?.slice(0, 500) ?? null,
      rightsConfirmed: false,
    });
  }
  if (rows.length === 0) return existing;
  const db = await getDb();
  await db.insert(assets).values(rows);
  return listAssets(workspaceId);
}

export async function addImageByUrl(workspaceId: string, rawUrl: string) {
  const url = await assertFetchableUrl(rawUrl);
  const saved = await importImageAssets(workspaceId, [{ url: url.toString(), sourceSnippet: "Added by URL" }]);
  const created = saved.find((asset) => asset.url === url.toString());
  if (!created) throw new OnboardingError("Could not add that image");
  return created;
}

export async function setAssetRights(input: {
  workspaceId: string;
  actorUserId: string;
  confirmedIds: string[];
}) {
  const db = await getDb();
  const rows = await listAssets(input.workspaceId);
  const confirmed = new Set(input.confirmedIds);
  for (const row of rows) {
    const rightsConfirmed = confirmed.has(row.id);
    if (rightsConfirmed === row.rightsConfirmed) continue;
    await db
      .update(assets)
      .set({ rightsConfirmed })
      .where(and(eq(assets.id, row.id), eq(assets.workspaceId, input.workspaceId)));
    await writeAudit({
      workspaceId: input.workspaceId,
      actor: input.actorUserId,
      action: "asset.rights_changed",
      data: { assetId: row.id, rightsConfirmed },
    });
  }
}
