"use client";

import { useActionState, useState } from "react";
import { inviteAction, type InviteState } from "./actions";

export function InviteForm({ packageId }: { packageId: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="packageId" value={packageId} />
        <label className="flex flex-col text-sm">
          GitHub user name
          <input name="login" required className="mt-1 rounded border px-2 py-1" placeholder="e.g. octocat" autoComplete="off" />
        </label>
        <button type="submit" disabled={pending} className="rounded bg-black px-3 py-1.5 text-white disabled:opacity-50">
          {pending ? "Inviting…" : "Invite as co-author"}
        </button>
      </form>
      {state.error ? <p className="mt-2 text-red-700" role="alert">{state.error}</p> : null}
      {state.ok ? (
        <div className="mt-3 rounded border bg-gray-50 p-3 text-sm" role="status">
          <p>
            Invitation for <b>{state.ok.login}</b> made.{" "}
            {state.ok.emailed ? "We emailed it to them too." : "Send them this link (it is shown only once):"}
          </p>
          <div className="mt-2 flex gap-2">
            <input readOnly value={state.ok.link} className="w-full rounded border px-2 py-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="rounded border px-2 py-1"
              onClick={() => { void navigator.clipboard.writeText(state.ok!.link).then(() => setCopied(true)); }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-gray-600">They sign in with that GitHub account to accept. The link works for 14 days.</p>
        </div>
      ) : null}
    </div>
  );
}
