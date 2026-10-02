"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel,
  className,
  disabled,
  ariaLabel,
}: {
  children: string;
  pendingLabel?: string;
  className: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} aria-label={ariaLabel} className={className}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
