"use server";

import { requireWorkspace } from "@/lib/auth/guards";
import { getCreditBalance } from "./ledger";

export async function creditBalanceAction(): Promise<{ balance: number }> {
  const { workspace } = await requireWorkspace();
  return { balance: await getCreditBalance(workspace.id) };
}
