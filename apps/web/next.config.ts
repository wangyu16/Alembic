import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source; Next transpiles them.
  transpilePackages: [
    "@alembic/package-contract",
    "@alembic/package-ops",
    "@alembic/renderer",
    "@alembic/ai-assist",
    "@alembic/ai-operations",
    "@alembic/github-bridge",
    "@alembic/research-events",
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
