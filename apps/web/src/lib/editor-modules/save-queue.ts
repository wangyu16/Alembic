/**
 * One host save at a time (loop r5, P5.B.3.w).
 *
 * The in-file editor waits 10 s for the host's acknowledgement
 * (orz-host-save@1, a family protocol constant), then reports a failure and
 * keeps the document dirty. A published save can take longer (commit, then
 * project), so the educator may press Save again while the first save is
 * still running. Before r5 the second save started at once and carried the
 * same base as the first — the first landed, and the second (the newer text)
 * was refused as "changed since you opened it". Queued, the second save
 * starts only after the first finished, so it reads the base the first one
 * moved forward and lands.
 */
export function oneAtATime<A, R>(run: (args: A) => Promise<R>): (args: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (args: A) => {
    const next = tail.then(() => run(args));
    tail = next.catch(() => undefined);
    return next;
  };
}
