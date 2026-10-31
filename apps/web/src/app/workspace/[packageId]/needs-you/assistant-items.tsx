import type { CourseOp } from "@alembic/package-ops";
import { answerDigestAction, decideProposalAction } from "./actions";

type Q = { id: string; text: string; choices?: string[]; recommended?: string };

/** The assistant's questions in one item (agent-runtime §14.1): plain text only, never links or markup. */
export function DigestItem({ packageId, id, questions }: { packageId: string; id: string; questions: Q[] }) {
  const recommended = questions.filter((q) => q.recommended).length;
  return (
    <form action={answerDigestAction} className="mt-2 space-y-3" data-testid="digest">
      <input type="hidden" name="packageId" value={packageId} />
      <input type="hidden" name="id" value={id} />
      {questions.map((q) => (
        <fieldset key={q.id} className="space-y-1">
          <legend className="whitespace-pre-wrap">{q.text}</legend>
          {q.choices ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {q.choices.map((c) => (
                <label key={c} className="flex items-center gap-1.5">
                  <input type="radio" name={`q:${q.id}`} value={c} />
                  {c}{c === q.recommended ? <span className="text-xs text-muted"> (suggested)</span> : null}
                </label>
              ))}
            </div>
          ) : (
            <input name={`q:${q.id}`} maxLength={1000} className="input w-full" placeholder="Your answer" aria-label={q.text} />
          )}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm">Send answers</button>
        {recommended ? <button className="btn btn-ghost btn-sm" name="acceptAll" value="1" formNoValidate>Accept all suggested ({recommended})</button> : null}
      </div>
      <p className="text-xs text-muted">Questions you leave empty stay open. An answer only guides the assistant; it approves nothing.</p>
    </form>
  );
}

/** A course change in plain words. */
export function describeOp(op: CourseOp): string {
  switch (op.op) {
    case "addChapters": return `Add chapters: ${op.titles.join(", ")}`;
    case "renameChapter": return `Rename chapter “${op.slug}” to “${op.title}”`;
    case "moveChapter": return `Move chapter “${op.slug}”`;
    case "removeChapter": return `Remove chapter “${op.slug}”`;
    case "setLicense": return `Change the licence to ${op.license}`;
    case "setCourseDetails": return "Change the course's title or description";
    case "setStatus": return `Mark ${op.paths.length} page${op.paths.length === 1 ? "" : "s"} ${op.status}`;
    default: return `Change the course (${op.op})`;
  }
}

export function ProposalItem({ packageId, id, op, mayDecide }: { packageId: string; id: string; op: CourseOp; mayDecide: boolean }) {
  return (
    <div className="mt-2" data-testid="proposal">
      <p>{describeOp(op)}</p>
      {mayDecide ? (
        <form className="mt-2 flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm" formAction={decideProposalAction.bind(null, packageId, id, true)}>Approve</button>
          <button className="btn btn-ghost btn-sm" formAction={decideProposalAction.bind(null, packageId, id, false)}>Decline</button>
        </form>
      ) : <p className="mt-1 text-muted">Waiting for the course owner.</p>}
    </div>
  );
}
