import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source; Next transpiles them.
  transpilePackages: [
    "@alembic/package-contract",
    "@alembic/renderer",
    "@alembic/ai-assist",
    "@alembic/research-events",
  ],
};

export default nextConfig;
