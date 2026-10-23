import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  clientIp,
  consumeRateLimit,
  FallbackRateStore,
  MemoryRateStore,
  PostgresRateStore,
  rateKey,
  rateSecret,
  type RateBucket,
  type RateDecision,
  type RateStore,
} from "@/lib/rate-limit";

/**
 * The server-side door to the rate limits (limits and rationale:
 * `lib/rate-limit.ts`). One in-process store per server instance; the
 * `report` bucket counts in Postgres when the service client and migration
 * 0023 are there, in-process otherwise.
 *
 * Usage (also for the portal search, Track A core):
 *
 *     import { headers } from "next/headers";
 *     const gate = await checkRateLimit("search", await headers());
 *     if (!gate.ok) … // show "too many searches, try again in N s"
 *
 * Never throws: a broken limiter lets the request through.
 */
const memory = new MemoryRateStore();

function storeFor(bucket: RateBucket): RateStore {
  if (bucket !== "report") return memory;
  const service = createServiceClient();
  return service ? new FallbackRateStore(new PostgresRateStore(service), memory) : memory;
}

export async function checkRateLimit(
  bucket: RateBucket,
  headers: Pick<Headers, "get">,
): Promise<RateDecision> {
  try {
    const key = rateKey(bucket, clientIp(headers), rateSecret());
    return await consumeRateLimit(storeFor(bucket), bucket, key);
  } catch {
    return { ok: true };
  }
}
