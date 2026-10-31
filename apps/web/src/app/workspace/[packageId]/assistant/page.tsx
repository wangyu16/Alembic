import Link from "next/link";
import { redirect } from "next/navigation";
import { can, type Role } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/db";
import { LocalTime } from "@/lib/local-time";
import { SubmitButton } from "../../submit-button";
import { RefreshWhile } from "../publish/refresh-while";
import { startAssistantAction, stopAssistantAction } from "./actions";
import { JOB_SIZES, MAX_TASK } from "./sizes";

export const dynamic = "force-dynamic";

type Job = { id: string; task: string; status: string; summary: string | null; spent_credits: number; budget_credits: number; started_at: string; ended_at: string | null };
const STATUS: Record<string, string> = {
  starting: "Getting ready…", running: "Working…", done: "Finished", failed: "Didn't finish", cancelled: "Stopped", paused: "Paused",
};

/** The course assistant (C4 step 4): ask, see the cost first, watch it work, see what it did. */
export default async function AssistantPage({ params, searchParams }: { params: Promise<{ packageId: string }>; searchParams: Promise<{ m?: string }> }) {
  const { packageId } = await params;
  const { m: message } = await searchParams;
  if (!v3Enabled()) redirect(`/workspace/${packageId}`);
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/assistant`)}`);
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!role) redirect("/workspace");
  const mayAsk = can(role as Role, "agent.talk");
  const [{ data: course }, { data: jobRows }, { data: account }] = await Promise.all([
    supabase.from("packages").select("title").eq("id", packageId).maybeSingle(),
    supabase.from("agent_jobs").select("id, task, status, summary, spent_credits, budget_credits, started_at, ended_at").eq("package_id", packageId).order("started_at", { ascending: false }).limit(10),
    supabase.from("ledger_accounts").select("id, debt").eq("kind", "user").eq("user_id", user.id).maybeSingle(),
  ]);
  const jobs = (jobRows ?? []) as Job[];
  const live = jobs.find((j) => j.status === "starting" || j.status === "running" || (j.status === "cancelled" && !j.ended_at));
  const { data: events } = live
    ? await supabase.from("agent_session_events").select("seq, kind, payload, at").eq("job_id", live.id).order("seq", { ascending: false }).limit(12)
    : { data: [] as Array<{ seq: number; kind: string; payload: { text?: string }; at: string }> };
  let balance = 0;
  if (account) {
    const { data: lots } = await supabase.from("credit_lots").select("remaining, expires_at").eq("account_id", account.id).gt("remaining", 0);
    const now = Date.now();
    balance = (lots ?? []).filter((l) => !l.expires_at || new Date(l.expires_at).getTime() > now).reduce((n, l) => n + Number(l.remaining), 0) - Number(account.debt ?? 0);
  }
  const { data: changes } = jobs.length
    ? await supabase.from("agent_changesets").select("job_id, status").in("job_id", jobs.map((j) => j.id))
    : { data: [] as Array<{ job_id: string; status: string }> };
  const landed = (job: string) => (changes ?? []).filter((c) => c.job_id === job && (c.status === "done" || c.status === "queued")).length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <p className="text-sm text-muted"><Link prefetch={false} href={`/workspace/${packageId}/course`}>← {(course?.title as string | undefined) ?? "Course"}</Link></p>
      <h1 className="page-title mt-2">Assistant</h1>
      <p className="mt-1 text-sm text-muted">Ask for work on this course. Everything it changes is saved like anyone&apos;s edit: you see it in History, and nothing is published until someone publishes.</p>
      <RefreshWhile active={Boolean(live)} everyMs={4000} />
      {message ? <p className="notice mt-4" role="status">{message}</p> : null}

      {live ? (
        <section className="panel mt-6 p-4" data-testid="assistant-live" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">{STATUS[live.status] ?? live.status}</h2>
            <span className="text-xs text-muted">up to {Number(live.budget_credits).toFixed(0)} credits set aside · started <LocalTime at={live.started_at} /></span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{live.task}</p>
          {(events ?? []).length ? (
            <ol className="mt-3 space-y-1 text-sm text-muted" data-testid="assistant-progress">
              {[...(events ?? [])].reverse().map((e) => <li key={e.seq}>{String((e.payload as { text?: unknown })?.text ?? "").slice(0, 300) || e.kind}</li>)}
            </ol>
          ) : null}
          {mayAsk && live.status !== "cancelled" ? (
            <form action={stopAssistantAction} className="mt-4">
              <input type="hidden" name="packageId" value={packageId} />
              <SubmitButton className="btn btn-ghost btn-sm" pending="Stopping…">Stop</SubmitButton>
            </form>
          ) : null}
        </section>
      ) : mayAsk ? (
        <form action={startAssistantAction} className="panel mt-6 space-y-4 p-4" data-testid="assistant-ask">
          <input type="hidden" name="packageId" value={packageId} />
          <label className="block">
            <span className="font-medium">What should the assistant do?</span>
            <textarea name="task" required maxLength={MAX_TASK} rows={4} className="input mt-2 w-full" placeholder="e.g. In chapter 6, add two worked examples on Hess's law after the first section." />
          </label>
          <fieldset>
            <legend className="font-medium">How big is it?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {JOB_SIZES.map((s, k) => (
                <label key={s.id} className="panel flex cursor-pointer flex-col gap-1 p-3 text-sm has-[:checked]:border-accent">
                  <span className="flex items-center gap-2 font-medium"><input type="radio" name="size" value={s.id} defaultChecked={k === 0} />{s.label}</span>
                  <span className="text-muted">{s.hint}</span>
                  <span>{s.usually}; at most {s.hold}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">You pay only what it uses; the rest comes back when it finishes. You have {balance.toFixed(0)} credits · <Link href="/workspace/credit">AI credit</Link></p>
          </fieldset>
          <SubmitButton className="btn btn-primary" pending="Starting…">Start</SubmitButton>
        </form>
      ) : (
        <p className="notice mt-6">Only the course&apos;s editors can ask the assistant.</p>
      )}

      {jobs.filter((j) => j !== live).length ? (
        <section className="mt-8" data-testid="assistant-history">
          <h2 className="font-medium">Earlier</h2>
          <ul className="panel mt-3 divide-y divide-edge-soft">
            {jobs.filter((j) => j !== live).map((j) => (
              <li key={j.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className={j.status === "done" ? "text-ok" : "text-muted"}>{STATUS[j.status] ?? j.status}</span>
                  <span className="text-xs text-muted"><LocalTime at={j.started_at} /> · {Number(j.spent_credits).toFixed(1)} credits{landed(j.id) ? ` · ${landed(j.id)} change${landed(j.id) === 1 ? "" : "s"} saved` : ""}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-muted">{j.task}</p>
                {j.summary ? <p className="mt-2 whitespace-pre-wrap">{j.summary}</p> : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">See exactly what changed in <Link href={`/workspace/${packageId}/history`}>History</Link>.</p>
        </section>
      ) : null}
    </main>
  );
}
