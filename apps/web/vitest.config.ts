import { defineConfig } from "vitest/config";

/**
 * Tests for the web app's *pure* modules only (URL/nav models, caches, pure
 * helpers) — no React, no jsdom. The include glob is pinned to `src/` on
 * purpose: vitest's default include would also sweep the generated `.next/`
 * tree, which is not source and must never gate CI.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
