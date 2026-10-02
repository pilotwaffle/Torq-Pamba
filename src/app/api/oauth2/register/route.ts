import { OAuthError, registerClient } from "@/lib/platform/authserver";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "Body must be JSON" }, { status: 400 });
  }
  try {
    return Response.json(await registerClient(body), { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof OAuthError) return Response.json({ error: error.error, error_description: error.message }, { status: 400 });
    throw error;
  }
}
