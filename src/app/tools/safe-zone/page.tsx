import type { Metadata } from "next";
import { PublicPage } from "@/components/public-chrome";
import { SafeZonePreviewer } from "@/components/tools/safe-zone-previewer";

export const metadata: Metadata = { title: "Safe-zone previewer" };

export default function SafeZonePage() {
  return (
    <PublicPage wide>
      <h1 className="display-serif text-3xl text-zinc-950">Safe-zone previewer</h1>
      <p className="mb-6 mt-3 text-sm text-zinc-700">Keep hooks and captions out from under the app&apos;s own buttons and text.</p>
      <SafeZonePreviewer />
    </PublicPage>
  );
}
