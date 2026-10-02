import {
  FIXTURE_NICHES,
  genericPosts,
  genericTrends,
  matchFixtureNiche,
  stableHash,
  toSourcePost,
} from "../fixtures";
import { profileUrl } from "../handles";
import { PLATFORMS, type ResearchSource, type SourcePost } from "../types";

/** Fixture data for keyless runs and tests. Never calls the network. */
export function createMockSource(now: () => Date = () => new Date()): ResearchSource {
  return {
    id: "mock",
    label: "Sample data",
    platforms: PLATFORMS,
    envKeys: [],
    sample: true,

    async lookupAccount({ platform, handle, limit }) {
      const known = FIXTURE_NICHES.find((niche) => niche.posts.some((post) => post.author === handle));
      const seed = stableHash(`${platform}:${handle}`);
      const niche = known ?? FIXTURE_NICHES[seed % FIXTURE_NICHES.length] ?? FIXTURE_NICHES[0];
      const base = niche ? niche.posts : genericPosts(handle);
      // Scale the niche's posts to this account so each handle gets its own, stable numbers.
      const factor = 0.05 + (seed % 60) / 100;
      const posts: SourcePost[] = base.slice(0, limit).map((post, index) =>
        toSourcePost(
          {
            ...post,
            platform,
            views: Math.round(post.views * factor * (index === 1 ? 3.2 : 1)),
            likes: Math.round(post.likes * factor * (index === 1 ? 3 : 1)),
            comments: Math.round(post.comments * factor),
            shares: Math.round(post.shares * factor),
            saves: Math.round(post.saves * factor),
            daysAgo: 1 + index * 3,
          },
          now(),
          handle,
        ),
      );
      return {
        account: {
          platform,
          handle,
          displayName: handle.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
          profileUrl: profileUrl(platform, handle),
          followerCount: 8_000 + (seed % 900) * 1_000,
        },
        posts,
      };
    },

    async discover({ niche, platform, limit }) {
      const fixture = matchFixtureNiche(niche);
      const posts = (fixture ? fixture.posts : genericPosts(niche)).map((post) => toSourcePost(post, now()));
      return posts.filter((post) => !platform || post.platform === platform).slice(0, limit);
    },

    async trends({ niche, platform }) {
      const fixture = matchFixtureNiche(niche);
      const rows = fixture ? fixture.trends : genericTrends(niche);
      return rows
        .filter((trend) => !platform || trend.platform === null || trend.platform === platform)
        .map((trend) => ({ ...trend, score: null, url: null }));
    },
  };
}

export const mockSource = createMockSource();
