import postgres from "postgres";
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(k); return v; };
const PKG = process.argv[2]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  if (!env("DATABASE_URL_POOLER").includes("whbhiqnzknxnaxlulqga")) throw new Error("not testing");
  const pg = postgres(env("DATABASE_URL_POOLER"), { ssl: "require", max: 1, prepare: false, onnotice: () => {} });
  try {
    const [r] = await pg`select owner_id::text as owner from public.packages where id = ${PKG}`;
    const req = await pg.begin(async (tx) => {
      await tx.unsafe(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [r.owner, JSON.stringify({ sub: r.owner, role: "authenticated" })]);
      await tx.unsafe(`set local role authenticated`);
      return (await tx.unsafe(`select public.request_publish($1, '{}'::jsonb) as id`, [PKG]))[0]!.id as string;
    });
    for (let k = 0; k < 200; k++) { const [p] = await pg`select status from public.publish_requests where id = ${req}::uuid`; if (!["queued", "running"].includes(p.status as string)) { console.log("publish request:", p.status); break; } await sleep(6000); }
    const [run] = await pg`select status, public_sha, results from public.publish_runs where package_id = ${PKG} order by created_at desc limit 1`;
    console.log("run:", run?.status, JSON.stringify(run?.results ?? {}).slice(0, 500));
    const [n] = await pg`select count(*)::int as n from public.published_files where package_id = ${PKG}`;
    const [pr] = await pg`select public_repo from public.packages where id = ${PKG}`;
    console.log("published files:", n.n, "public repo:", JSON.stringify(pr.public_repo));
  } finally { await pg.end(); }
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
