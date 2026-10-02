import { requireWorkspace } from "@/lib/auth/guards";
import { BillingError, createTopUpCheckout } from "@/lib/billing";
import { billingError, readField, redirectTo } from "@/lib/credits/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, workspace } = await requireWorkspace();
  const pack = await readField(request, "pack");
  try {
    const result = await createTopUpCheckout(workspace, pack, new URL(request.url).origin, user.id);
    return redirectTo(request, result.url);
  } catch (error) {
    if (error instanceof BillingError) return billingError(request, error.message);
    throw error;
  }
}
