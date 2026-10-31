import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIONS, readOneClick } from "@/lib/one-click";
import { answerOneClickAction } from "./actions";

export const dynamic = "force-dynamic";

// Opening this page changes nothing (mail scanners open links); only the button does.
export default async function OneClickPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const r = readOneClick(token, user?.id ?? null);

  const shell = (body: React.ReactNode) => <main className="mx-auto max-w-xl p-6">{body}</main>;
  if (r.state === "invalid") {
    return shell(<p>This link has expired or isn&apos;t valid. <Link href="/workspace" className="underline">Open your courses</Link> to answer there.</p>);
  }
  if (r.state === "sign-in") {
    return shell(<p><Link href={`/signin?next=${encodeURIComponent(`/act/${token}`)}`} className="underline">Sign in</Link> to answer this.</p>);
  }
  if (r.state === "someone-else") {
    return shell(<p>This link was sent to someone else. <Link href="/workspace" className="underline">Open your courses</Link>.</p>);
  }

  const { data: item } = await supabase
    .from("needs_you")
    .select("id, kind, state, chapter, payload, package_id")
    .eq("id", r.claim.item)
    .maybeSingle();
  if (!item || (item.state !== "waiting" && item.state !== "shown")) {
    return shell(<p>This has already been answered, or it no longer applies. <Link href="/workspace" className="underline">Open your courses</Link>.</p>);
  }
  const title = (item.payload as { title?: unknown } | null)?.title;
  return shell(
    <>
      <h1 className="text-xl font-semibold">{typeof title === "string" ? title : "Please confirm"}</h1>
      {item.chapter ? <p className="mt-1 text-sm text-gray-600">{item.chapter as string}</p> : null}
      {error ? <p className="mt-3 text-red-700">That didn&apos;t work. You may not be able to decide this one; open the course to see why.</p> : null}
      <form action={answerOneClickAction} className="mt-4 flex gap-3">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="rounded bg-black px-3 py-1.5 text-white">{ACTIONS[r.claim.action]!.button}</button>
        <Link href={`/workspace/${encodeURIComponent(item.package_id as string)}`} className="px-3 py-1.5 underline">Open the course instead</Link>
      </form>
    </>,
  );
}
