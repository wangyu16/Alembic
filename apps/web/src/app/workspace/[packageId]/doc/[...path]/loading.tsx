/** Shown at once while the page reads the course (RC.22: a blank screen for seconds looked broken). */
export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl p-6" aria-busy="true">
      <p className="text-sm text-muted">Opening…</p>
    </main>
  );
}
