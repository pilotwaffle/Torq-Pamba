import { requireWorkspace } from "@/lib/auth/guards";
import { BillingError, createCheckout } from "@/lib/billing";
import { billingError, readField, redirectTo } from "@/lib/credits/http";
import { toPlanId } from "@/lib/credits/plans";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, workspace } = await requireWorkspace();
  const plan = toPlanId(await readField(request, "plan"));
  if (!plan) return billingError(request, "Unknown plan");
  try {
    const result = await createCheckout(workspace, plan, new URL(request.url).origin, user.id);
    return redirectTo(request, result.url);
  } catch (error) {
    if (error instanceof BillingError) return billingError(request, error.message);
    throw error;
  }
}
