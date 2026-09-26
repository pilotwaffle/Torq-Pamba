import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { workspaces, type BrandBrief, type Workspace } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { getWorkspace } from "@/lib/workspace";
import { OnboardingError } from "./errors";

const briefSchema = z.object({
  companyName: z.string().trim().max(200).optional(),
  niche: z.string().trim().max(200).optional(),
  whatTheyDo: z.string().trim().max(4000).optional(),
  products: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
  audience: z.string().trim().max(500).optional(),
  tone: z.string().trim().max(80).optional(),
  logoUrl: z.string().trim().max(2000).optional(),
  websiteUrl: z.string().trim().max(2000).optional(),
});

export function suggestNiche(input: {
  whatTheyDo?: string;
  products?: string[];
  audience?: string;
}): string {
  const hay = `${input.whatTheyDo ?? ""} ${(input.products ?? []).join(" ")} ${input.audience ?? ""}`.toLowerCase();
  if (/coffee|cold brew|espresso|cafe|café/.test(hay)) return "Cold brew coffee";
  if (/fitness|yoga|wellness/.test(hay)) return "Wellness";
  if (/\bsoftware\b|\bsaas\b|\bapp\b/.test(hay)) return "Software";
  return "";
}

export function linesToList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export async function saveBrief(input: {
  workspaceId: string;
  actorUserId: string;
  brief: BrandBrief;
  advanceTo?: number;
  requireIdentity?: boolean;
}): Promise<Workspace> {
  const brief = normalizeBrief(input.brief);
  if (input.requireIdentity && (!brief.companyName || !brief.niche)) {
    throw new OnboardingError("Company name and niche are required");
  }
  const current = await getWorkspace(input.workspaceId);
  if (!current) throw new OnboardingError("Workspace not found");
  const onboardingStep = input.advanceTo
    ? Math.max(current.onboardingStep, input.advanceTo)
    : current.onboardingStep;
  const db = await getDb();
  const [updated] = await db
    .update(workspaces)
    .set({ brief, onboardingStep, updatedAt: new Date() })
    .where(eq(workspaces.id, input.workspaceId))
    .returning();
  if (!updated) throw new OnboardingError("Workspace not found");
  await writeAudit({
    workspaceId: updated.id,
    actor: input.actorUserId,
    action: "brief.saved",
    data: {
      companyName: brief.companyName ?? "",
      niche: brief.niche ?? "",
      onboardingStep,
    },
  });
  return updated;
}

export async function advanceOnboarding(workspaceId: string, step: number): Promise<void> {
  const current = await getWorkspace(workspaceId);
  if (!current) throw new OnboardingError("Workspace not found");
  const onboardingStep = Math.max(current.onboardingStep, step);
  if (onboardingStep === current.onboardingStep) return;
  const db = await getDb();
  await db
    .update(workspaces)
    .set({ onboardingStep, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
}

function normalizeBrief(input: BrandBrief): BrandBrief {
  const parsed = briefSchema.safeParse({
    ...input,
    products: input.products?.map((product) => product.trim()).filter(Boolean),
  });
  if (!parsed.success) throw new OnboardingError("Check the brand brief fields");
  const data = parsed.data;
  const brief: BrandBrief = {};
  const companyName = blank(data.companyName);
  const niche = blank(data.niche);
  const whatTheyDo = blank(data.whatTheyDo);
  const audience = blank(data.audience);
  const tone = blank(data.tone);
  const logoUrl = optionalHttpUrl(data.logoUrl, "Logo URL");
  const websiteUrl = optionalHttpUrl(data.websiteUrl, "Website URL");
  if (companyName) brief.companyName = companyName;
  if (niche) brief.niche = niche;
  if (whatTheyDo) brief.whatTheyDo = whatTheyDo;
  if (audience) brief.audience = audience;
  if (tone) brief.tone = tone;
  if (logoUrl) brief.logoUrl = logoUrl;
  if (websiteUrl) brief.websiteUrl = websiteUrl;
  if (data.products && data.products.length > 0) brief.products = data.products;
  return brief;
}

function blank(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalHttpUrl(value: string | undefined, label: string): string | undefined {
  const trimmed = blank(value);
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new OnboardingError(`${label} must be an http or https URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OnboardingError(`${label} must be an http or https URL`);
  }
  url.hash = "";
  return url.toString();
}
