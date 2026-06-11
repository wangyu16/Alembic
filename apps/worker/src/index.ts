/**
 * Worker entry point. M6 connects this to the job queue; until then it
 * verifies the process boots and the workspace packages resolve.
 */

import { rendererVersion } from "@alembic/renderer";

console.log(`[alembic-worker] ready (renderer: ${rendererVersion()})`);
console.log("[alembic-worker] queue transport arrives in M6; exiting.");
