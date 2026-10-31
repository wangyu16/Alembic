import { loadElement, elementBytes } from "@/lib/shared-element";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/** A shared figure's bytes from the course's public copy, served so nothing in it can run (element-sharing-v3 §3). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const e = await loadElement((await params).id);
  if (!e || e.kind !== "figure") return new Response("No longer available", { status: 410, headers: { "cache-control": "public, s-maxage=300" } });
  const bytes = await elementBytes(e);
  const type = TYPES[(e.path.split(".").pop() ?? "").toLowerCase()];
  if (!bytes || !type) return new Response("No longer available", { status: 410 });
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": type,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "public, max-age=60, s-maxage=240, stale-while-revalidate=60",
    },
  });
}
