import { requireWorkspace } from "@/lib/auth/guards";
import { BillingError, createPortalSession } from "@/lib/billing";
import { billingError, redirectTo } from "@/lib/credits/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();
  try {
    const result = await createPortalSession(workspace, new URL(request.url).origin);
    return redirectTo(request, result.url);
  } catch (error) {
    if (error instanceof BillingError) return billingError(request, error.message);
    throw error;
  }
}
