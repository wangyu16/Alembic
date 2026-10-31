import { agentAuth, catchUp } from "@/lib/agent-endpoint";
import { send } from "../_shared";

export const dynamic = "force-dynamic";

/** Catch-up: what changed since a commit, and the answers to this session's questions (R.24, §14.1). */
export async function GET(req: Request) {
  const auth = await agentAuth(req);
  if (!auth.ok) return send(auth.reply);
  return send(await catchUp(auth.ctx, new URL(req.url).searchParams.get("since")));
}
