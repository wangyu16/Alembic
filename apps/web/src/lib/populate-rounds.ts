/**
 * Commit a package upload's documents in rounds (Phase 5 Track B.3).
 *
 * A document's relative links become platform permalinks (`/d/{docId}`)
 * before it is committed, and a permalink exists only for a REGISTERED file.
 * A document that links to another document of the same upload therefore has
 * to wait until that one is committed and registered. Each round commits
 * every document whose links all resolve, registers them, and retries the
 * rest; a round with no progress ends the loop, and what is left (a broken
 * link, or documents that only link to each other) is returned for the
 * educator as fixable problems.
 *
 * Pure orchestration over injected steps, so the ordering is unit-tested
 * without GitHub or Supabase.
 *
 * ## Known limits (by design for now; pinned by populate-rounds.test.ts)
 *
 * - **Rounds = longest link chain.** A chain d1→d2→…→dN (each document links
 *   to the next) commits one document per round: N rounds, N commits, N
 *   registrations. A long chain therefore spends the run's time budget and
 *   finishes over several resumed runs (`partial` → the client posts again).
 * - **Resolves are O(n²).** Every held document is re-resolved each round,
 *   so that chain costs N(N+1)/2 resolves (465 for N = 30), each a
 *   link-rewrite with registry lookups.
 * - **Cycles never commit.** Documents that link to each other — the common
 *   "previous / next chapter" pair, or any ring — can never resolve, because
 *   each waits for the other's permalink. They are returned as `unresolved`
 *   and reported to the educator as broken links; nothing of them is
 *   committed.
 *
 * Why not pre-mint ids so everything resolves in one round: the documents
 * held here are lean `.md` sources (the committed source of record;
 * educator-version-contract §7), which carry no `#orz-meta` island, so there
 * is nowhere to embed a pre-minted uid that registration would adopt — a
 * plain `.md` registers by hash/location only. Reserving registry rows before
 * the commit instead would write the projection ahead of the repository,
 * against the repo-first write rule (storage-and-write-paths.md §3). Either
 * route needs a contract change (an identity carrier for `.md`, or a
 * reserve-then-commit registry step), not an orchestration tweak.
 */

export interface RoundSteps<C> {
  /** The change with its links rewritten, or null when a link can't resolve yet. */
  resolve(change: C): Promise<C | null>;
  /** Commit (repos first, then the projection). `done: false` = out of time. */
  commit(changes: C[]): Promise<{ done: boolean; remaining: number }>;
  /** Register just-committed documents so the next round can link to them. */
  register(changes: C[]): Promise<void>;
  /** The run's time budget is spent — stop before starting more work. */
  outOfTime(): boolean;
}

export type RoundsResult<C> =
  | { kind: "done"; committed: C[]; unresolved: C[] }
  | { kind: "partial"; remaining: number };

export async function commitInRounds<C>(
  documents: C[],
  steps: RoundSteps<C>,
): Promise<RoundsResult<C>> {
  const committed: C[] = [];
  let todo = documents;
  while (todo.length > 0) {
    const ready: C[] = [];
    const held: C[] = [];
    for (const change of todo) {
      // Nothing of this round is committed yet: hand all of it to the next run.
      if (steps.outOfTime()) return { kind: "partial", remaining: todo.length };
      const resolved = await steps.resolve(change);
      if (resolved === null) held.push(change);
      else ready.push(resolved);
    }
    if (ready.length === 0) return { kind: "done", committed, unresolved: held };
    const round = await steps.commit(ready);
    if (!round.done) return { kind: "partial", remaining: round.remaining + held.length };
    committed.push(...ready);
    if (held.length === 0) break;
    await steps.register(ready);
    todo = held;
  }
  return { kind: "done", committed, unresolved: [] };
}
