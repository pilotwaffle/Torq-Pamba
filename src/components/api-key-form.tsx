"use client";

import { useActionState } from "react";
import { createApiKeyAction } from "@/lib/platform/actions";
import { fieldClass, primaryButton } from "./ui";

export function ApiKeyForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(createApiKeyAction, undefined);
  return (
    <div>
      <form action={action} className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Key name</span>
          <input name="name" className={fieldClass} aria-label="Key name" maxLength={60} placeholder="Zapier, Claude, CI…" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Access</span>
          <select name="scope" className={fieldClass} aria-label="Access" defaultValue="read">
            <option value="read">Read only</option>
            <option value="write">Read and generate (spends budget)</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Monthly credit ceiling</span>
          <input name="maxCredits" type="number" min="0" step="1" className={fieldClass} aria-label="Monthly credit ceiling" placeholder="No ceiling" />
        </label>
        <div className="sm:col-span-4">
          <button type="submit" className={primaryButton} disabled={disabled || pending}>
            Create API key
          </button>
        </div>
      </form>
      {state?.error ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      {state?.key ? (
        <div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">Copy this key now. It will not be shown again.</p>
          <code aria-label="New API key" className="mt-2 block break-all rounded bg-white px-2 py-1 font-mono text-xs">
            {state.key}
          </code>
        </div>
      ) : null}
    </div>
  );
}
