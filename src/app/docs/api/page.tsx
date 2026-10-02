import type { Metadata } from "next";
import { PublicPage } from "@/components/public-chrome";

export const metadata: Metadata = { title: "API and MCP" };

const code = "block overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-100";

export default function ApiDocsPage() {
  return (
    <PublicPage>
      <h1 className="display-serif text-3xl text-zinc-950">API and MCP</h1>
      <div className="mt-6 space-y-6 text-sm leading-6 text-zinc-800">
        <section>
          <h2 className="text-lg font-semibold">Keys</h2>
          <p>
            Create a key in the studio under Settings → API keys and MCP. Keys are shown once and stored as a SHA-256 hash. A read-only key cannot generate.
            A monthly credit ceiling on a key limits how many credits calls through it can spend; the workspace budget still applies. Failed generations are never charged.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold">REST: /api/v1</h2>
          <pre className={code}>{`curl -H "X-API-Key: tpk_..." https://YOUR_HOST/api/v1/me
curl -H "X-API-Key: tpk_..." -H "content-type: application/json" \\
  -d '{"prompt":"30s video about oat-milk cold brew","durationS":30,"tier":"standard"}' \\
  https://YOUR_HOST/api/v1/videos`}</pre>
          <ul className="mt-2 list-disc pl-5">
            <li>GET /me · GET /videos · GET /videos/:id · POST /videos · POST /estimate · GET /schedule · GET /analytics · GET /knowledge</li>
            <li>401 bad or missing key · 403 read-only key · 402 over the key&apos;s credit ceiling or the workspace budget · 422 every model failed (not charged) · 429 over 120 requests a minute</li>
            <li>Generated videos still need approval in the studio. The API cannot approve, schedule or publish.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-lg font-semibold">MCP: /api/mcp</h2>
          <p>
            Streamable HTTP, JSON responses, stateless. Tools: get_workspace, list_videos, get_video, estimate_video_cost, create_video, list_schedule,
            get_analytics, list_knowledge. Authenticate with <code>Authorization: Bearer tpk_...</code>, or let the client use OAuth: an unauthenticated call
            returns 401 with <code>resource_metadata</code> pointing at <code>/.well-known/oauth-protected-resource</code>.
          </p>
          <p className="mt-2">
            OAuth 2.1: authorization code with PKCE (S256), public clients, dynamic client registration at <code>/api/oauth2/register</code>, metadata at{" "}
            <code>/.well-known/oauth-authorization-server</code>. On the consent screen you choose read-only or generate, and a monthly credit ceiling.
          </p>
        </section>
      </div>
    </PublicPage>
  );
}
