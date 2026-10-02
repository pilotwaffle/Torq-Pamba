import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { creatorBriefs, type BrandBrief, type CreatorBrief, type CreatorBriefBody, type CreatorDeliverable } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { parseManifest } from "@/lib/router";
import { getWorkspaceVideo } from "@/lib/videos";
import { provenHooks } from "./knowledge";

/**
 * Creator sourcing briefs. Torq-Pamba writes the brief; the customer posts it
 * on TikTok One (Creator Marketplace) or a UGC marketplace (Billo, Collabstr)
 * from their own account. There is no marketplace API call here.
 */

export class CreatorBriefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreatorBriefError";
  }
}

export const MARKETPLACES = ["tiktok_one", "billo", "collabstr"] as const;
export type Marketplace = (typeof MARKETPLACES)[number];
export const MARKETPLACE_LABEL: Record<Marketplace, string> = {
  tiktok_one: "TikTok One",
  billo: "Billo",
  collabstr: "Collabstr",
};

export const DISCLOSURE_RULE =
  "Paid content must be disclosed: turn on TikTok's content disclosure (Paid partnership) or Instagram's Paid partnership label, and say #ad in the caption. AI-generated elements keep their AI label.";

export type CreatorBriefInput = {
  title: string;
  budgetUsd: number;
  videoCount: number;
  lengthS: number;
  platforms: CreatorDeliverable["platform"][];
  usageRightsDays: number;
  allowSparkAds: boolean;
  allowPartnershipAds: boolean;
  dueDate: string;
  marketplaces: Marketplace[];
};

export function validateBriefInput(input: CreatorBriefInput): string[] {
  const errors: string[] = [];
  if (!input.title.trim()) errors.push("Give the brief a title");
  if (input.title.length > 120) errors.push("Title must be 120 characters or fewer");
  if (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0) errors.push("Budget must be more than $0");
  if (input.budgetUsd > 100_000) errors.push("Budget over $100,000 needs a custom contract");
  if (!Number.isInteger(input.videoCount) || input.videoCount < 1 || input.videoCount > 50) errors.push("Ask for 1 to 50 videos");
  if (!Number.isInteger(input.lengthS) || input.lengthS < 5 || input.lengthS > 180) errors.push("Video length must be 5 to 180 seconds");
  if (input.platforms.length === 0) errors.push("Choose at least one platform");
  if (!Number.isInteger(input.usageRightsDays) || input.usageRightsDays < 0 || input.usageRightsDays > 3650) errors.push("Usage rights must be 0 to 3650 days");
  if (input.marketplaces.length === 0) errors.push("Choose where you will post the brief");
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) errors.push("Due date must be YYYY-MM-DD");
  return errors;
}

/** Pure: assembles the brief body from the brand brief, the reference video, and proven hooks. */
export function buildCreatorBriefBody(input: {
  form: CreatorBriefInput;
  brand: BrandBrief | null | undefined;
  referenceVideo?: { title: string; hook: string; lines: string[] } | null;
  provenHooks: string[];
}): CreatorBriefBody {
  const brand = input.brand ?? {};
  const product = brand.products?.find((item) => item.trim())?.trim() || brand.companyName?.trim() || "our product";
  const hooks = [...new Set([...input.provenHooks, ...(input.referenceVideo?.hook ? [input.referenceVideo.hook] : [])])].slice(0, 3);
  const perPlatform = Math.max(1, Math.round(input.form.videoCount / input.form.platforms.length));
  const deliverables: CreatorDeliverable[] = input.form.platforms.map((platform) => ({
    platform,
    format: platform === "tiktok" ? "Vertical 9:16 TikTok video" : platform === "instagram" ? "Vertical 9:16 Reel" : "Vertical 9:16 Facebook Reel",
    count: perPlatform,
    lengthS: input.form.lengthS,
  }));
  return {
    product,
    audience: brand.audience?.trim() || "",
    deliverables,
    hooks,
    talkingPoints: [
      ...(brand.whatTheyDo?.trim() ? [brand.whatTheyDo.trim()] : []),
      ...(input.referenceVideo?.lines ?? []).slice(0, 3),
    ],
    dos: [
      "Open with the hook in the first 2 seconds, on screen and spoken.",
      "Show the product in use, in your own space, in natural light.",
      "Keep text inside the safe zone (avoid the bottom 20% and the right edge).",
      ...(brand.tone?.trim() ? [`Match the brand's tone: ${brand.tone.trim()}.`] : []),
    ],
    donts: [
      "No medical, financial or guaranteed-result claims.",
      "No copyrighted music unless it comes from the platform's commercial library.",
      "Do not remove or hide AI or paid-partnership labels.",
    ],
    usageRightsDays: input.form.usageRightsDays,
    allowSparkAds: input.form.allowSparkAds,
    allowPartnershipAds: input.form.allowPartnershipAds,
    budgetUsd: Math.round(input.form.budgetUsd * 100) / 100,
    dueDate: input.form.dueDate,
    marketplaces: input.form.marketplaces,
    disclosure: DISCLOSURE_RULE,
    referenceVideoTitle: input.referenceVideo?.title ?? "",
  };
}

/** Markdown brief to paste into a TikTok One campaign (or any marketplace's description field). */
export function briefToMarkdown(title: string, body: CreatorBriefBody): string {
  const lines = [
    `# ${title}`,
    "",
    `**Product:** ${body.product}`,
    ...(body.audience ? [`**Audience:** ${body.audience}`] : []),
    `**Budget:** $${body.budgetUsd.toFixed(2)}${body.dueDate ? ` · **Due:** ${body.dueDate}` : ""}`,
    `**Post on:** ${body.marketplaces.map((m) => MARKETPLACE_LABEL[m]).join(", ")}`,
    "",
    "## Deliverables",
    ...body.deliverables.map((d) => `- ${d.count} × ${d.format}, about ${d.lengthS}s`),
    "",
    ...(body.hooks.length ? ["## Hooks that already worked for us", ...body.hooks.map((h) => `- “${h}”`), ""] : []),
    ...(body.talkingPoints.length ? ["## Talking points", ...body.talkingPoints.map((t) => `- ${t}`), ""] : []),
    "## Do",
    ...body.dos.map((d) => `- ${d}`),
    "",
    "## Don't",
    ...body.donts.map((d) => `- ${d}`),
    "",
    "## Usage rights",
    `- Organic and paid usage for ${body.usageRightsDays} days from delivery.`,
    `- Spark Ads authorization code: ${body.allowSparkAds ? "required on delivery (TikTok)" : "not needed"}.`,
    `- Partnership ads permission: ${body.allowPartnershipAds ? "required on delivery (Instagram/Facebook)" : "not needed"}.`,
    "",
    "## Disclosure",
    body.disclosure,
    ...(body.referenceVideoTitle ? ["", `Reference video: ${body.referenceVideoTitle}`] : []),
    "",
  ];
  return lines.join("\n");
}

/** Neutralizes spreadsheet formula injection and quotes per RFC 4180. */
export function csvCell(value: string | number | boolean): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_COLUMNS = [
  "brief_title",
  "platform",
  "format",
  "video_count",
  "length_seconds",
  "budget_usd",
  "due_date",
  "usage_rights_days",
  "spark_ads_code",
  "partnership_ads",
  "hooks",
  "do",
  "dont",
  "disclosure",
] as const;

/** One row per deliverable, for Billo / Collabstr bulk orders or a shared sheet. */
export function briefToCsv(title: string, body: CreatorBriefBody): string {
  const rows = body.deliverables.map((d) =>
    [
      title,
      d.platform,
      d.format,
      d.count,
      d.lengthS,
      body.budgetUsd.toFixed(2),
      body.dueDate,
      body.usageRightsDays,
      body.allowSparkAds ? "yes" : "no",
      body.allowPartnershipAds ? "yes" : "no",
      body.hooks.join(" | "),
      body.dos.join(" | "),
      body.donts.join(" | "),
      body.disclosure,
    ]
      .map(csvCell)
      .join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

export async function saveCreatorBrief(input: {
  workspaceId: string;
  brand: BrandBrief | null | undefined;
  videoId?: string | null;
  form: CreatorBriefInput;
  actor: string;
}): Promise<CreatorBrief> {
  const errors = validateBriefInput(input.form);
  if (errors.length > 0) throw new CreatorBriefError(errors[0] ?? "Invalid brief");
  let reference: { title: string; hook: string; lines: string[] } | null = null;
  if (input.videoId) {
    const video = await getWorkspaceVideo(input.workspaceId, input.videoId);
    if (!video) throw new CreatorBriefError("Reference video not found");
    const manifest = parseManifest(video.manifest);
    reference = { title: video.title, hook: manifest?.hook ?? "", lines: manifest?.scenes.map((scene) => scene.line) ?? [] };
  }
  const proven = await provenHooks(input.workspaceId);
  const body = buildCreatorBriefBody({ form: input.form, brand: input.brand, referenceVideo: reference, provenHooks: proven.hooks });
  const db = await getDb();
  const [row] = await db
    .insert(creatorBriefs)
    .values({ workspaceId: input.workspaceId, videoId: input.videoId || null, title: input.form.title.trim(), body, createdBy: input.actor })
    .returning();
  if (!row) throw new CreatorBriefError("Could not save the brief");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "creator_brief.created",
    data: { briefId: row.id, marketplaces: body.marketplaces, budgetUsd: body.budgetUsd },
  });
  return row;
}

export async function listCreatorBriefs(workspaceId: string) {
  const db = await getDb();
  return db.select().from(creatorBriefs).where(eq(creatorBriefs.workspaceId, workspaceId)).orderBy(desc(creatorBriefs.createdAt));
}

export async function getCreatorBrief(workspaceId: string, briefId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(creatorBriefs)
    .where(and(eq(creatorBriefs.id, briefId), eq(creatorBriefs.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}
