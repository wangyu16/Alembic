import { agentAuth, handIn } from "@/lib/agent-endpoint";
import { jsonBody, send } from "../_shared";

export const dynamic = "force-dynamic";

/** The agent hands in a changeset (agent-runtime-v3 §4.1, §11, §14, §15). */
export async function POST(req: Request) {
  const auth = await agentAuth(req);
  if (!auth.ok) return send(auth.reply);
  const body = await jsonBody(req);
  if (body && typeof body === "object" && "tooBig" in body) return send({ status: 413, body: { error: "at most 12 MB per hand-in" } });
  if (body && typeof body === "object" && "invalid" in body) return send({ status: 400, body: { error: "not JSON" } });
  return send(await handIn(auth.ctx, body));
}
