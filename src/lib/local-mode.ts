/**
 * Explicit local/test mode for machine endpoints. When CRON_SECRET or
 * STRIPE_WEBHOOK_SECRET is unset, `/api/cron/tick` and `/api/billing/webhook`
 * accept unauthenticated calls only when ALLOW_INSECURE_LOCAL_ENDPOINTS=1 and
 * NODE_ENV is not production. Everywhere else a missing secret means "reject".
 */
export function allowsInsecureLocalEndpoints(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALLOW_INSECURE_LOCAL_ENDPOINTS?.trim() === "1" && env.NODE_ENV !== "production";
}
