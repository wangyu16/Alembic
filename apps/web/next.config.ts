import type { NextConfig } from "next";
import path from "node:path";

// Self-hosted builds (the testing VM): ALEMBIC_STANDALONE=1 emits a
// self-contained server in .next/standalone. Vercel builds don't set it.
const standalone = process.env["ALEMBIC_STANDALONE"] === "1";

const nextConfig: NextConfig = {
  // The image optimizer (sharp) is platform-specific; a standalone build copied to another OS serves images as they are.
  ...(standalone ? { output: "standalone" as const, outputFileTracingRoot: path.join(__dirname, "../.."), images: { unoptimized: true } } : {}),
  // Workspace packages are consumed as TypeScript source; Next transpiles them.
  transpilePackages: [
    "@alembic/package-contract",
    "@alembic/package-ops",
    "@alembic/renderer",
    "@alembic/ai-assist",
    "@alembic/ai-operations",
    "@alembic/github-bridge",
    "@alembic/research-events",
    "@alembic/notify",
  ],
  experimental: {
    serverActions: {
      // The hosted-editor round trip (generate + save) carries a FULL
      // self-contained orz-family document — source AND rendered HTML — through
      // a Server Action. orz-slides' inline bundle (reveal.js + orz-markdown +
      // themes) alone is ~1 MB, over Next's 1 MB default and enough to 500 both
      // the initial generate and every save. Give real headroom for growth
      // (bigger decks, orz-paged joining this same path later).
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
