"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-16 text-center">
      <h1 className="font-serif text-2xl tracking-tight text-ink">
        Something went wrong
      </h1>
      <p className="text-muted">
        That didn’t work as expected. Your saved materials are safe — please try
        again.
      </p>
      <div className="flex justify-center gap-3">
        <button
          onClick={reset}
          className="btn btn-primary"
        >
          Try again
        </button>
        <a
          href="/workspace"
          className="btn btn-ghost"
        >
          Back to workspace
        </a>
      </div>
    </main>
  );
}
