import { agentAuth, postEvent } from "@/lib/agent-endpoint";
import { jsonBody, send } from "../_shared";

export const dynamic = "force-dynamic";

/** The agent's progress, messages and hand-over notes (§4.4). */
export async function POST(req: Request) {
  const auth = await agentAuth(req);
  if (!auth.ok) return send(auth.reply);
  const body = await jsonBody(req);
  if (body && typeof body === "object" && ("tooBig" in body || "invalid" in body)) return send({ status: 400, body: { error: "an event is a small JSON object" } });
  return send(await postEvent(auth.ctx, body));
}
