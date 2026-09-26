import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import {
  DEMO_AUDIENCE,
  DEMO_COMPANY,
  DEMO_DESCRIPTION,
  DEMO_OG_DESCRIPTION,
  DEMO_PRODUCTS,
  DEMO_WHAT_THEY_DO,
} from "@/lib/onboarding/demoSite";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const host = (headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "").split(",")[0]?.trim();
  const proto = headerList.get("x-forwarded-proto") === "https" ? "https" : "http";
  let metadataBase: URL | undefined;
  if (host && /^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    try {
      metadataBase = new URL(`${proto}://${host}`);
    } catch {
      metadataBase = undefined;
    }
  }
  return {
    metadataBase,
    title: { absolute: DEMO_COMPANY },
    description: DEMO_DESCRIPTION,
    openGraph: {
      title: DEMO_COMPANY,
      description: DEMO_OG_DESCRIPTION,
      siteName: DEMO_COMPANY,
      images: [{ url: "/demo-site/og.svg", alt: DEMO_COMPANY }],
    },
  };
}

export default function DemoSitePage() {
  return (
    <div className="min-h-screen bg-[#f3ecdf] text-[#1c1410]">
      <header className="bg-[#1c1410] text-[#f3ecdf]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <Image src="/demo-site/og.svg" alt="Northwind Cold Brew logo" width={48} height={48} unoptimized />
            <span>Northwind</span>
          </div>
          <p className="text-sm text-[#e4d2ae]">Cold brew, canned for the commute</p>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-4xl font-semibold tracking-tight">{DEMO_COMPANY}</h1>
        <p className="mt-3 max-w-prose text-lg">Smooth coffee that waits in the fridge, not in a line.</p>
        <h2 className="mt-10 text-xl font-semibold">What we do</h2>
        <p className="mt-3 max-w-prose leading-7">{DEMO_WHAT_THEY_DO}</p>
        <h2 className="mt-10 text-xl font-semibold">Products</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 leading-7">
          {DEMO_PRODUCTS.map((product) => (
            <li key={product}>{product}</li>
          ))}
        </ul>
        <p className="mt-10 text-lg">{DEMO_AUDIENCE}</p>
        <Image
          src="/demo-site/can.svg"
          alt="Oat-milk cold brew can"
          width={72}
          height={112}
          unoptimized
          className="mt-6"
        />
      </main>
    </div>
  );
}
