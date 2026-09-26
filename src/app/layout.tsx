import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Torq-Pamba",
    template: "%s · Torq-Pamba",
  },
  description:
    "Compliance-first AI UGC studio. Make, approve, and schedule short videos. Torq-Pamba never publishes them for you.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-zinc-950 antialiased">{children}</body>
    </html>
  );
}
