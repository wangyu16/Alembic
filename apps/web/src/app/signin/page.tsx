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
        <h1 className="font-serif text-3xl tracking-tight text-ink">Sign in</h1>
        <p className="mt-2 leading-relaxed text-muted">
          Connect the account that safely stores and publishes your open
          teaching materials.
        </p>
      </div>
      <button
        onClick={signInWithGitHub}
        disabled={busy}
        className="btn btn-primary py-3"
      >
        {busy ? "Connecting…" : "Continue with GitHub"}
      </button>
      {(error ?? params.get("error")) && (
        <p className="text-sm text-danger">
          {error ?? "Sign-in did not complete. Please try again."}
        </p>
      )}
      <p className="text-sm text-faint leading-relaxed">
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
