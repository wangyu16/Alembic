import Link from "next/link";
import { redirect } from "next/navigation";
import { NEEDS_YOU_LABEL, NEEDS_YOU_RANK, type NeedsYouKind } from "@alembic/notify";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { answerItemAction } from "./actions";

export const dynamic = "force-dynamic";

/** Kinds only the owner (or deputy) decides — mirrors needs_you_answer. */
const OWNER_KINDS = new Set(["approve", "to-confirm", "suggestion", "update", "method-version", "reconnect", "ready"]);
/** Kinds this page answers itself; the rest open where they are decided. */
const HERE = new Set(["question", "to-confirm", "update", "suggestion"]);

interface Item { id: string; kind: NeedsYouKind; chapter: string | null; payload: { title?: string; detail?: string } | null; created_at: string; addressed_to: string[] }

export default async function NeedsYouPage({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/needs-you`)}`);
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!role) redirect("/workspace");
  const decides = role === "owner" || role === "deputy";

  const { data } = await supabase
    .from("needs_you")
    .select("id, kind, chapter, payload, created_at, addressed_to")
    .eq("package_id", packageId)
    .in("state", ["waiting", "shown"]);
  const items = ((data ?? []) as Item[])
    .filter((i) => i.addressed_to.length === 0 || i.addressed_to.includes(user.id))
    .sort((a, b) => NEEDS_YOU_RANK[a.kind] - NEEDS_YOU_RANK[b.kind] || a.created_at.localeCompare(b.created_at));
  const groups = new Map<string, Item[]>();
  for (const i of items) groups.set(i.chapter ?? "Course", [...(groups.get(i.chapter ?? "Course") ?? []), i]);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <p className="text-sm"><Link href={`/workspace/${packageId}`}>← Course</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">Needs you</h1>
      {items.length === 0 ? <p className="mt-4">Nothing needs you right now.</p> : null}
      {[...groups].map(([chapter, list]) => (
        <section key={chapter} className="mt-6">
          <h2 className="font-medium">{chapter}</h2>
          <ul className="mt-2 divide-y rounded border">
            {list.map((i) => {
              const title = i.payload?.title;
              const canAct = decides || !OWNER_KINDS.has(i.kind);
              return (
                <li key={i.id} className="p-3 text-sm">
                  <p><span className="font-medium">{NEEDS_YOU_LABEL[i.kind]}</span>{title ? `: ${title}` : ""}</p>
                  {i.payload?.detail ? <p className="mt-1 text-gray-600">{i.payload.detail}</p> : null}
                  {!canAct ? (
                    <p className="mt-1 text-gray-600">Waiting for the course owner.</p>
                  ) : HERE.has(i.kind) ? (
                    <form action={answerItemAction} className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="packageId" value={packageId} />
                      <input type="hidden" name="id" value={i.id} />
                      {i.kind === "question" ? (
                        <>
                          <label className="sr-only" htmlFor={`a-${i.id}`}>Your answer</label>
                          <input id={`a-${i.id}`} name="text" required className="min-w-0 flex-1 rounded border px-2 py-1" placeholder="Your answer" />
                          <button className="rounded bg-black px-3 py-1 text-white">Answer</button>
                        </>
                      ) : i.kind === "to-confirm" ? (
                        <button className="rounded bg-black px-3 py-1 text-white">Confirm</button>
                      ) : (
                        <button className="underline" title="It won't come back unless it changes.">Dismiss</button>
                      )}
                    </form>
                  ) : (
                    <p className="mt-1"><Link className="underline" href={`/workspace/${packageId}`}>Open the course to decide</Link></p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
