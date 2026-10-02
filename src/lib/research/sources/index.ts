import { defineAdapter } from "@/lib/providers/types";
import { apifySource } from "./apify";
import { mockSource } from "./mock";
import { scrapeCreatorsSource } from "./scrapecreators";
import { youtubeSource } from "./youtube";

/** Research data sources, registered under the `research-source` provider kind. */
export const adapter = defineAdapter({
  id: "research",
  "research-source": [mockSource, youtubeSource, scrapeCreatorsSource, apifySource],
});
