"use client";

import { useState } from "react";

type Theme = "dark" | "light";

/**
 * Light/dark toggle. Flips `<html data-theme>` instantly (app chrme re-themes
 * with no reload) and persists the choice in the `alembic-theme` cookie, which
 * the server reads to (a) render the same theme on the next request without a
 * flash and (b) pick orz-markdown's light-neat vs dark-elegant for rendered
 * markdown + `.md.html` output. Seeded with the server-known theme so there's
 * no hydration mismatch.
 */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    document.cookie = `alembic-theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="text-base leading-none text-muted transition-colors hover:text-ink"
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
    >
      {theme === "light" ? "☾" : "☀"}
    </button>
  );
}
