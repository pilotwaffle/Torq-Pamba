import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-chrome";
import { cardClass } from "@/components/ui";

export const metadata: Metadata = { title: "Free tools for short-form video" };

const TOOLS = [
  { href: "/tools/safe-zone", title: "Safe-zone previewer", body: "See where TikTok, Reels and Facebook draw their buttons and captions over your 9:16 frame. Files never leave your browser." },
  { href: "/tools/captions", title: "Caption toolkit", body: "Turn a script into timed on-screen captions (SRT) and check a post caption against platform limits." },
  { href: "/tools/de-slop", title: "De-slop rewriter", body: "Strip the stock phrases that make captions read as AI-written, with every change explained." },
];

export default function ToolsPage() {
  return (
    <PublicPage>
      <h1 className="display-serif text-3xl text-zinc-950">Free tools</h1>
      <p className="mt-3 text-sm text-zinc-700">No sign-up. Everything runs in your browser.</p>
      <div className="mt-6 grid gap-4">
        {TOOLS.map((tool) => (
          <Link key={tool.href} href={tool.href} className={`${cardClass} block p-5 hover:border-emerald-600`}>
            <h2 className="text-lg font-semibold">{tool.title}</h2>
            <p className="mt-1 text-sm text-zinc-700">{tool.body}</p>
          </Link>
        ))}
      </div>
      <p className="mt-8 text-xs text-zinc-500">
        We do not offer a metadata scrubber. Removing AI-provenance metadata (C2PA, platform AI labels) is something Torq-Pamba will not build.
      </p>
    </PublicPage>
  );
}
