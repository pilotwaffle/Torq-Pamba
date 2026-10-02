import { ProviderUnavailableError } from "@/lib/providers/types";

/**
 * JSON fetch for research sources. Errors carry the status and a short body,
 * never the request headers, so keys stay out of messages and logs.
 */
export async function fetchJson(
  sourceId: string,
  url: string,
  init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
    });
  } catch (error) {
    throw new ProviderUnavailableError(sourceId, error instanceof Error ? error.message : "network");
  }
  const text = await response.text();
  if (!response.ok) {
    throw new ProviderUnavailableError(sourceId, `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new ProviderUnavailableError(sourceId, "response was not JSON");
  }
}

export function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Unix seconds or an ISO string to a Date. */
export function when(value: unknown): Date | null {
  const seconds = num(value);
  if (seconds !== null) return new Date(seconds * 1000);
  const text = str(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
