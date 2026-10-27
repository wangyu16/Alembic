import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isInvitationToken } from "@/lib/invitations";
import { acceptInvitationAction } from "./actions";

export const dynamic = "force-dynamic";

// Opening the link changes nothing; joining takes the button, signed in as the invited account.
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const shell = (body: React.ReactNode) => <main className="mx-auto max-w-xl p-6">{body}</main>;
  if (!isInvitationToken(token)) return shell(<p>This invitation link isn&apos;t complete. Ask for a new one.</p>);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return shell(
      <>
        <h1 className="text-xl font-semibold">You&apos;re invited to work on a course</h1>
        <p className="mt-2">Sign in with the GitHub account the invitation was made for, then come back to this page.</p>
        <p className="mt-4"><Link href={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`} className="rounded bg-black px-3 py-1.5 text-white">Sign in with GitHub</Link></p>
      </>,
    );
  }
  return shell(
    <>
      <h1 className="text-xl font-semibold">You&apos;re invited to work on a course</h1>
      {error ? (
        <p className="mt-2 text-red-700" role="alert">
          This invitation can&apos;t be used: it may have expired, been used or cancelled, or be meant for another GitHub account. Ask the course owner for a new one.
        </p>
      ) : (
        <p className="mt-2">You&apos;ll join as a co-author: you edit with the owner, who approves and publishes.</p>
      )}
      <form action={acceptInvitationAction} className="mt-4">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="rounded bg-black px-3 py-1.5 text-white">Join the course</button>
      </form>
    </>,
  );
}
