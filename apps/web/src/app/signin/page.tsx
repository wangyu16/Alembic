"use client";

import { createBrowserClient } from "@supabase/ssr";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function SignInInner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();

  async function signInWithGitHub() {
    setBusy(true);
    setError(null);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anonKey) {
        throw new Error("Sign-in is not configured yet on this deployment.");
      }
      const supabase = createBrowserClient(url, anonKey);
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: `${location.origin}/auth/callback?next=/workspace`,
        },
      });
      if (oauthError) throw oauthError;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Connect the account that safely stores and publishes your open
          teaching materials.
        </p>
      </div>
      <button
        onClick={signInWithGitHub}
        disabled={busy}
        className="rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {busy ? "Connecting…" : "Continue with GitHub"}
      </button>
      {(error ?? params.get("error")) && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {error ?? "Sign-in did not complete. Please try again."}
        </p>
      )}
      <p className="text-sm text-zinc-500">
        Signing in only confirms who you are. Alembic never gets access to your
        repositories until you explicitly connect publishing later.
      </p>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInInner />
    </Suspense>
  );
}
