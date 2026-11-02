import { agentAuth, changesetStatus } from "@/lib/agent-endpoint";
import { send } from "../../_shared";

export const dynamic = "force-dynamic";

/** What became of one of this job's changesets (§4.2). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await agentAuth(req);
  if (!auth.ok) return send(auth.reply);
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return send({ status: 400, body: { error: "not a changesetId" } });
  return send(await changesetStatus(auth.ctx, id));
}
