export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-16 text-center">
      <h1 className="font-serif text-2xl tracking-tight text-ink">Not found</h1>
      <p className="text-muted">
        We couldn’t find that page or package.
      </p>
      <div className="flex justify-center gap-3">
        <a
          href="/workspace"
          className="btn btn-primary"
        >
          Back to workspace
        </a>
        <a
          href="/portal"
          className="btn btn-ghost"
        >
          Discover
        </a>
      </div>
    </main>
  );
}
