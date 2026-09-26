export function safeNext(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\") || value.includes("://") || value.includes("%")) return fallback;
  if (value.startsWith("/login") || value.startsWith("/signup")) return fallback;
  return value;
}

export function authHref(path: "/login" | "/signup", nextPath: string, error?: string): string {
  const params = new URLSearchParams();
  if (nextPath !== "/app") params.set("next", nextPath);
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
