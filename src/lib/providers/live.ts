import { ProviderRefusedError, ProviderUnavailableError } from "./types";

export function isLive(envKeys: string[]): boolean {
  if (process.env.PROVIDER_MODE !== "live") return false;
  if (process.env.NODE_ENV === "test") return false;
  return envKeys.every((key) => Boolean(process.env[key]?.trim()));
}

export async function postJson(
  providerId: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ProviderUnavailableError(providerId, error instanceof Error ? error.message : "network");
  }
  return readBody(providerId, response);
}

export async function getJson(providerId: string, url: string, headers: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new ProviderUnavailableError(providerId, error instanceof Error ? error.message : "network");
  }
  return readBody(providerId, response);
}

async function readBody(providerId: string, response: Response): Promise<unknown> {
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { raw: text };
    }
  }
  if (!response.ok) {
    const message = text.slice(0, 300);
    if (response.status === 400 || response.status === 422 || /safety|refus|blocked/i.test(message)) {
      throw new ProviderRefusedError(providerId, message || "Provider refused the prompt");
    }
    throw new ProviderUnavailableError(providerId, message || `HTTP ${response.status}`);
  }
  return json;
}

export async function pollUntil(
  providerId: string,
  check: () => Promise<"pending" | "done">,
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await check()) === "done") return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new ProviderUnavailableError(providerId, "timed out");
}
