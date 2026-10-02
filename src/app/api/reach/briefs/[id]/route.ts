import { readSession } from "@/lib/auth/session";
import { briefToCsv, briefToMarkdown, getCreatorBrief } from "@/lib/reach/creators";
import { getWorkspaceForUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function filename(title: string, ext: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "creator-brief";
  return `${slug}.${ext}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) return new Response("Sign in first", { status: 401 });
  const current = await getWorkspaceForUser(session.user.id);
  if (!current) return new Response("No workspace", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const brief = await getCreatorBrief(current.workspace.id, id);
  if (!brief) return new Response("Not found", { status: 404 });
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "md";
  const body = format === "csv" ? briefToCsv(brief.title, brief.body) : briefToMarkdown(brief.title, brief.body);
  return new Response(body, {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename(brief.title, format)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
