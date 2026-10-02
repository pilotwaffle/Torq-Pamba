import type { Metadata } from "next";
import { PublicPage } from "@/components/public-chrome";
import { DeslopTool } from "@/components/tools/deslop-tool";

export const metadata: Metadata = { title: "De-slop rewriter" };

export default function DeslopPage() {
  return (
    <PublicPage wide>
      <h1 className="display-serif text-3xl text-zinc-950">De-slop rewriter</h1>
      <p className="mb-6 mt-3 text-sm text-zinc-700">
        Rewrites stock AI phrasing. It does not hide that content is AI-generated: keep the platform&apos;s AI label on.
      </p>
      <DeslopTool />
    </PublicPage>
  );
}
