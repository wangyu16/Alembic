"use client";

import { useFormStatus } from "react-dom";

/** A submit button that shows progress and can't be pressed twice while the action runs. */
export function SubmitButton({ children, pending, className }: { children: React.ReactNode; pending: string; className?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" disabled={busy} aria-busy={busy} className={className}>
      {busy ? pending : children}
    </button>
  );
}
