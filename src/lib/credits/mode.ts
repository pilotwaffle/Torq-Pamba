export function stripeSecretKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.STRIPE_SECRET_KEY?.trim() ?? "";
}

/**
 * With no Stripe key, checkout is simulated and grants credits without payment
 * so dev, tests and e2e run keyless. Never in a production build that makes
 * live vendor calls: simulated credits must not pay for real generations.
 */
export function simulatedBillingAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (stripeSecretKey(env)) return false;
  return !(env.NODE_ENV === "production" && env.PROVIDER_MODE?.trim() === "live");
}

/** Granted once per workspace while billing is simulated. Real billing grants the plan's `signup_credits` (0 for Free). */
export const SIMULATED_STARTER_CREDITS = 5_000;
