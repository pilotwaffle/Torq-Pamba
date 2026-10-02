import type { Metadata } from "next";
import { PublicPage } from "@/components/public-chrome";
import { CaptionToolkit } from "@/components/tools/caption-toolkit";

export const metadata: Metadata = { title: "Caption toolkit" };

export default function CaptionsPage() {
  return (
    <PublicPage>
      <h1 className="display-serif text-3xl text-zinc-950">Caption toolkit</h1>
      <p className="mb-6 mt-3 text-sm text-zinc-700">Most short-form video is watched muted. Captions keep the hook readable.</p>
      <CaptionToolkit />
    </PublicPage>
  );
}
