import { agentAuth, readFile } from "@/lib/agent-endpoint";
import { send } from "../_shared";

export const dynamic = "force-dynamic";

/** A course file's current text and version (the version becomes the base of a later hand-in). */
export async function GET(req: Request) {
  const auth = await agentAuth(req);
  if (!auth.ok) return send(auth.reply);
  const path = new URL(req.url).searchParams.get("path") ?? "";
  return send(await readFile(auth.ctx, path));
}
