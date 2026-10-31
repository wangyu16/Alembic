import "server-only";
import { headers } from "next/headers";
import { appBaseUrl } from "@/lib/app-url";

/**
 * An absolute origin for links made on the server (Stripe return URLs,
 * invitation links): the configured app URL, else this request's own host.
 * Never empty, so a link is never accidentally relative.
 */
export async function serverOrigin(): Promise<string> {
  const configured = appBaseUrl();
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
