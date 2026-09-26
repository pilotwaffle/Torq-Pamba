"use server";

import { redirect } from "next/navigation";
import type { BrandBrief } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth/guards";
import { AvatarError } from "@/lib/avatars/store";
import { addImageByUrl, importImageAssets, setAssetRights } from "./assets";
import { advanceOnboarding, linesToList, saveBrief, suggestNiche } from "./brief";
import { OnboardingError } from "./errors";
import type { BrandExtraction } from "./extract";
import { getBrandExtractor } from "./extract";
import { assertFetchableUrl, FetchSiteError, fetchSite } from "./fetchSite";

export type AnalyzeResult =
  | { ok: true; extraction: BrandExtraction; websiteUrl: string }
  | { ok: false; error: string };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function userMessage(error: unknown, fallback: string): string {
  if (error instanceof OnboardingError || error instanceof FetchSiteError || error instanceof AvatarError) {
    return error.message;
  }
  return fallback;
}

function fail(path: string, error: unknown, fallback: string): never {
  const message = encodeURIComponent(userMessage(error, fallback));
  const join = path.includes("?") ? "&" : "?";
  redirect(`${path}${join}error=${message}`);
}

export async function analyzeWebsiteAction(formData: FormData): Promise<AnalyzeResult> {
  await requireWorkspace();
  try {
    const page = await fetchSite(field(formData, "websiteUrl"));
    const extraction = await getBrandExtractor().extract(page.html, page.url);
    return { ok: true, extraction, websiteUrl: page.url };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not analyze that website") };
  }
}

export async function saveExtractedBriefAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    const products = linesToList(field(formData, "products"));
    const whatTheyDo = field(formData, "whatTheyDo");
    const audience = field(formData, "audience");
    const niche = workspace.brief?.niche?.trim() || suggestNiche({ whatTheyDo, products, audience });
    const brief: BrandBrief = {
      companyName: field(formData, "companyName"),
      niche,
      whatTheyDo,
      products,
      audience,
      tone: field(formData, "tone"),
      logoUrl: field(formData, "logoUrl"),
      websiteUrl: field(formData, "websiteUrl"),
    };
    await saveBrief({
      workspaceId: workspace.id,
      actorUserId: user.id,
      brief,
      advanceTo: 2,
    });
    const images = await keepFetchable([
      ...parseImages(field(formData, "imagesJson")),
      ...(brief.logoUrl ? [{ url: brief.logoUrl, sourceSnippet: "logo" }] : []),
    ]);
    await importImageAssets(workspace.id, images);
  } catch (error) {
    fail("/app/onboarding", error, "Could not save the brand brief");
  }
  redirect("/app/onboarding");
}

export async function saveManualBriefAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const companyName = field(formData, "companyName").trim();
  const niche = field(formData, "niche").trim();
  const whatTheyDo = field(formData, "whatTheyDo").trim();
  if (!companyName || !niche || !whatTheyDo) {
    fail("/app/onboarding?manual=1", new OnboardingError("Company name, niche, and what you do are required"), "");
  }
  try {
    await saveBrief({
      workspaceId: workspace.id,
      actorUserId: user.id,
      brief: {
        ...workspace.brief,
        companyName,
        niche,
        whatTheyDo,
      },
      advanceTo: 2,
    });
  } catch (error) {
    fail("/app/onboarding?manual=1", error, "Could not save the brand brief");
  }
  redirect("/app/onboarding");
}

export async function confirmBriefAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    await saveBrief({
      workspaceId: workspace.id,
      actorUserId: user.id,
      requireIdentity: true,
      advanceTo: 3,
      brief: {
        companyName: field(formData, "companyName"),
        niche: field(formData, "niche"),
        whatTheyDo: field(formData, "whatTheyDo"),
        products: linesToList(field(formData, "products")),
        audience: field(formData, "audience"),
        tone: field(formData, "tone"),
        logoUrl: workspace.brief?.logoUrl,
        websiteUrl: workspace.brief?.websiteUrl,
      },
    });
  } catch (error) {
    fail("/app/onboarding", error, "Could not confirm the brand brief");
  }
  redirect("/app/onboarding");
}

export async function saveBriefPageAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    await saveBrief({
      workspaceId: workspace.id,
      actorUserId: user.id,
      requireIdentity: true,
      brief: {
        companyName: field(formData, "companyName"),
        niche: field(formData, "niche"),
        whatTheyDo: field(formData, "whatTheyDo"),
        products: linesToList(field(formData, "products")),
        audience: field(formData, "audience"),
        tone: field(formData, "tone"),
        logoUrl: field(formData, "logoUrl"),
        websiteUrl: field(formData, "websiteUrl"),
      },
    });
  } catch (error) {
    fail("/app/brief", error, "Could not save the brand brief");
  }
  redirect("/app/brief?saved=1");
}

export async function mediaAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const intent = field(formData, "intent");
  try {
    await setAssetRights({
      workspaceId: workspace.id,
      actorUserId: user.id,
      confirmedIds: formData.getAll("rights").filter((value): value is string => typeof value === "string"),
    });
    if (intent === "add") {
      const imageUrl = field(formData, "imageUrl").trim();
      if (!imageUrl) throw new OnboardingError("Enter an image URL");
      await addImageByUrl(workspace.id, imageUrl);
    } else {
      await advanceOnboarding(workspace.id, 4);
    }
  } catch (error) {
    fail("/app/onboarding", error, "Could not update media");
  }
  redirect("/app/onboarding");
}

export async function continueAvatarAction() {
  const { workspace } = await requireWorkspace();
  try {
    await advanceOnboarding(workspace.id, 5);
  } catch (error) {
    fail("/app/onboarding", error, "Could not continue");
  }
  redirect("/app/onboarding");
}

export async function finishOnboardingAction() {
  const { workspace } = await requireWorkspace();
  try {
    await advanceOnboarding(workspace.id, 6);
  } catch (error) {
    fail("/app/onboarding", error, "Could not finish onboarding");
  }
  redirect("/app");
}

function parseImages(raw: string): { url: string; sourceSnippet: string }[] {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const images: { url: string; sourceSnippet: string }[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as { value?: unknown; source?: unknown };
    if (typeof record.value !== "string") continue;
    images.push({
      url: record.value,
      sourceSnippet: typeof record.source === "string" ? record.source : "",
    });
  }
  return images.slice(0, 24);
}

async function keepFetchable(images: { url: string; sourceSnippet: string }[]) {
  const kept: { url: string; sourceSnippet: string }[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    try {
      const url = (await assertFetchableUrl(image.url)).toString();
      if (seen.has(url)) continue;
      seen.add(url);
      kept.push({ url, sourceSnippet: image.sourceSnippet });
    } catch {
      continue;
    }
  }
  return kept;
}
