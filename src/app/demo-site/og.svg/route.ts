import { ogMarkSvg } from "@/lib/onboarding/demoSite";

export function GET() {
  return new Response(ogMarkSvg(), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
