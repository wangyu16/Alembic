import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests for the web app's *pure* modules only (URL/nav models, caches, pure
 * helpers) — no React, no jsdom. The include glob is pinned to `src/` on
 * purpose: vitest's default include would also sweep the generated `.next/`
 * tree, which is not source and must never gate CI.
 */
export default defineConfig({
  // The app's `@/…` import alias (tsconfig `paths`), so a test can load a
  // module that uses it (with its IO dependencies mocked).
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
