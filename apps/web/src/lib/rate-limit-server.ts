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

/** Buckets counted in Postgres (shared across server instances) when possible. */
const SHARED: ReadonlySet<RateBucket> = new Set<RateBucket>(["report", "preview", "reconcile", "a11yAuto", "a11yCheck", "contact", "contactEmail"]);

function storeFor(bucket: RateBucket): RateStore {
  if (!SHARED.has(bucket)) return memory;
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

/**
 * Per signed-in USER (security loop r2, LOW-5): for surfaces that need a
 * session anyway (`/api/preview`), where an address is the wrong subject — a
 * class behind one NAT shares it, one user can rotate it. Never throws.
 */
export async function checkUserRateLimit(bucket: RateBucket, userId: string): Promise<RateDecision> {
  try {
    const key = rateKey(bucket, `user:${userId}`, rateSecret());
    return await consumeRateLimit(storeFor(bucket), bucket, key);
  } catch {
    return { ok: true };
  }
}

/**
 * Per COURSE (owner decision 2, 2026-10-24): the automatic accessibility
 * check is bounded per package, whoever's saves trigger it. Never throws.
 */
export async function checkPackageRateLimit(bucket: RateBucket, packageId: string): Promise<RateDecision> {
  try {
    const key = rateKey(bucket, `package:${packageId}`, rateSecret());
    return await consumeRateLimit(storeFor(bucket), bucket, key);
  } catch {
    return { ok: true };
  }
}

/**
 * Per arbitrary SUBJECT (e.g. `email:someone@school.edu` for the contact
 * form). The subject only enters the HMAC'd key; it is never stored. Never throws.
 */
export async function checkSubjectRateLimit(bucket: RateBucket, subject: string): Promise<RateDecision> {
  try {
    const key = rateKey(bucket, subject, rateSecret());
    return await consumeRateLimit(storeFor(bucket), bucket, key);
  } catch {
    return { ok: true };
  }
}
