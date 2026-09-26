import type { ReactNode } from "react";
import { PublicFooter, PublicHeader } from "@/components/public-chrome";

export function LegalDocument({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12">
        <p className="border border-amber-800/40 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Draft — review by counsel before launch
        </p>
        <h1 className="display-serif mt-6 text-3xl text-zinc-950">{title}</h1>
        <p className="mt-3 text-sm text-zinc-600">
          Effective September 26, 2026. Operator: Torq-Pamba (operator TBD).
        </p>
        <div className="mt-8 flex flex-col gap-8 text-sm leading-7 text-zinc-800">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}

export function LegalSection({
  title,
  paragraphs,
  list,
}: {
  title: string;
  paragraphs: string[];
  list?: string[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {list ? (
        <ul className="list-disc pl-5">
          {list.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
