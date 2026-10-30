import Link from "next/link";
import { redirect } from "next/navigation";
import { canWritePath, fileKind, normalizePath, type Role } from "@alembic/package-contract";
import { diffLines } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/db";
import { courseRepo, textVersion } from "@/lib/course-v3";
import { documentHistory } from "@/lib/history-v3";
import { GithubBusy, githubBusy } from "@/lib/github-busy";
import { LocalTime } from "@/lib/local-time";
import { restoreVersionAction } from "../actions";

export const dynamic = "force-dynamic";

/** A document's History (history-v3 §1–§3): its last 50 versions, compare any two, restore one as the newest. */
async function HistoryInner({ params, searchParams }: { params: Promise<{ packageId: string; path: string[] }>; searchParams: Promise<{ a?: string; b?: string; m?: string }> }) {
  const { packageId, path: parts } = await params;
  const { a, b, m } = await searchParams;
  if (!v3Enabled()) redirect(`/workspace/${packageId}`);
  let path: string;
  try { path = normalizePath(parts.map(decodeURIComponent).join("/")); } catch { redirect(`/workspace/${packageId}/course`); }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/history/${path}`)}`);
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!role) redirect("/workspace");
  const h = await documentHistory(packageId, path);
  if (!h) return <main className="p-6">This course can&apos;t be reached right now.</main>;
  const isText = fileKind(path) === "text";
  const mayRestore = canWritePath(role as Role, path);
  const c = await courseRepo(packageId);
  const current = isText && c ? await c.repo.readFile(h.head, path) : null;
  // The version the person sees: a text's sha256, or a figure's blob id (audit r1 M-1).
  const seen = isText ? (current === null ? null : textVersion(current))
    : c ? ((await c.client.listTreeEntries({ owner: c.owner, repo: c.name }, h.head)).entries.find((e) => e.path === path)?.sha ?? null) : null;
  const valid = (x?: string) => (x && /^[0-9a-f]{40}$/.test(x) && h.entries.some((e) => e.sha === x) ? x : null);
  const ca = valid(a);
  const cb = b === "current" ? "current" : valid(b);
  let diff: ReturnType<typeof diffLines> | null = null;
  if (isText && c && ca && cb) {
    const [ta, tb] = await Promise.all([c.repo.readFile(ca, path), cb === "current" ? Promise.resolve(current) : c.repo.readFile(cb, path)]);
    diff = diffLines(ta ?? "", tb ?? "");
  }
  const docHref = `/workspace/${packageId}/doc/${path.split("/").map(encodeURIComponent).join("/")}`;
  const who = (w: (typeof h.entries)[number]["who"]) =>
    w.kind === "member" ? w.name : w.kind === "assistant" ? `the assistant, for ${w.forName}` : w.kind === "github" ? `edited on GitHub${w.login ? ` (${w.login})` : ""}` : "Alembic";

  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-sm"><Link prefetch={false} className="underline" href={docHref}>← Back to the document</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">History</h1>
      <p className="mt-1 text-sm text-gray-600">{path} — the last {h.entries.length} versions, newest first. Restoring brings a version back as the newest one; nothing is lost.</p>
      {m ? <p className="mt-3 rounded border border-sky-300 bg-sky-50 p-2 text-sm text-sky-950" role="status">{m}</p> : null}
      {diff ? (
        <section className="mt-4 rounded border p-3" data-testid="diff">
          <h2 className="font-medium">Compared{diff.ok ? `: ${diff.added} lines added, ${diff.removed} removed` : ""}</h2>
          {!diff.ok ? <p className="mt-1 text-sm">These versions are too different or too large to compare here.</p> : (
            <pre className="mt-2 max-h-[60vh] overflow-auto whitespace-pre-wrap text-xs leading-5">
              {diff.lines.map((l, k) => l.op === "fold"
                ? <div key={k} className="text-gray-500">… {l.count} unchanged lines …</div>
                : <div key={k} className={l.op === "add" ? "bg-green-100 text-green-950" : l.op === "remove" ? "bg-red-100 text-red-950 line-through" : ""}>{l.op === "add" ? "+ " : l.op === "remove" ? "− " : "  "}{l.text}</div>)}
            </pre>
          )}
        </section>
      ) : null}
      <form className="mt-4" method="get">
        {/* The form's default button (Enter in a field) is Compare, never a Restore (audit r1). */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        <table className="w-full text-sm" data-testid="history">
          <thead><tr className="text-left"><th className="py-1">When</th><th>Who</th><th>What</th>{isText ? <th>Compare</th> : null}<th /></tr></thead>
          <tbody className="divide-y">
            {h.entries.map((e, k) => (
              <tr key={e.sha} className="align-top">
                <td className="py-2 pr-2"><LocalTime at={e.date} /></td>
                <td className="py-2 pr-2">{who(e.who)}</td>
                <td className="py-2 pr-2">{e.summary}{e.kept ? <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-950">kept version</span> : null}{e.published ? <span className="ml-2 rounded bg-green-100 px-1 text-xs text-green-950">on the website</span> : null}</td>
                {isText ? <td className="py-2 pr-2 whitespace-nowrap"><label><input type="radio" name="a" value={e.sha} defaultChecked={e.sha === ca} /> from</label> <label><input type="radio" name="b" value={e.sha} defaultChecked={e.sha === cb} /> to</label></td> : null}
                <td className="py-2">{k > 0 && mayRestore ? <button className="underline" formMethod="post" formAction={restoreVersionAction.bind(null, packageId, path, e.sha, seen, null)}>Restore</button> : k === 0 ? <span className="text-xs text-gray-600">current</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {isText ? (
          <p className="mt-3 text-sm">
            <label className="mr-3"><input type="radio" name="b" value="current" defaultChecked={cb === "current"} /> compare with the current text</label>
            <button className="rounded border px-2 py-0.5">Compare</button>
          </p>
        ) : null}
      </form>
      <p className="mt-4 text-xs text-gray-600">Older versions remain in the course&apos;s history on GitHub.</p>
    </main>
  );
}

export default async function HistoryPage(props: Parameters<typeof HistoryInner>[0]) {
  try {
    return await HistoryInner(props);
  } catch (e) {
    const busy = githubBusy(e);
    if (!busy) throw e;
    return <GithubBusy until={busy.until} back={"/workspace"} />;
  }
}
