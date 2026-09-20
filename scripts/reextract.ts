/**
 * Bulk re-analysis: re-runs extraction on documents produced by an older
 * schema/prompt (documents.extraction_version < EXTRACTION_VERSION), one at a
 * time through the Worker so each run is ledgered and the original comes
 * back from the owner's Drive.
 *
 *   node scripts/reextract.ts                 # against production
 *   PA_BASE_URL=http://localhost:8787 node scripts/reextract.ts
 *   node scripts/reextract.ts --limit 20 --dry   # list, don't run
 *
 * The bearer token is read from APP_BEARER_TOKEN or Secret Manager via gcloud.
 * Every document re-run bills Claude (≈¥5 each on Opus 5); --limit is the cap.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name: string, dflt: string | null = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const LIMIT = Number(flag("--limit", "50"));
const DRY = args.includes("--dry");
const BASE = process.env.PA_BASE_URL ?? "https://pa.solidstart.jp";
const PROJECT = "solidstart-paper-archive";

function token(): string {
  if (process.env.APP_BEARER_TOKEN) return process.env.APP_BEARER_TOKEN;
  return execFileSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", "--secret=APP_BEARER_TOKEN", `--project=${PROJECT}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}
const headers = { Authorization: `Bearer ${token()}` };

const stale = (await (await fetch(`${BASE}/api/admin/stale?limit=${LIMIT}`, { headers })).json()) as {
  current_version: number; documents: Array<{ id: string; space_id: string; extraction_version: number }>;
};
console.log(`current version ${stale.current_version}; ${stale.documents.length} stale document(s)${DRY ? " (dry run)" : ""}`);
let ok = 0, failed = 0, usd = 0;
for (const d of stale.documents) {
  process.stdout.write(`${d.id}  v${d.extraction_version} → `);
  if (DRY) { console.log("skip"); continue; }
  const started = Date.now();
  const res = await fetch(`${BASE}/api/documents/${d.id}/reanalyze`, { method: "POST", headers });
  const body = (await res.json()) as { cost?: { total_usd: number }; with_image?: boolean; error?: string; stage?: string; document?: { title: string } };
  if (res.ok) {
    ok++; usd += body.cost?.total_usd ?? 0;
    console.log(`v${stale.current_version}  ${body.with_image ? "image" : "text "}  $${(body.cost?.total_usd ?? 0).toFixed(3)}  ${Date.now() - started}ms  ${body.document?.title ?? ""}`);
  } else {
    failed++;
    console.log(`FAILED ${res.status} ${body.error ?? ""} ${body.stage ?? ""}`);
  }
}
console.log(`done: ${ok} ok, ${failed} failed, ≈$${usd.toFixed(3)} (≈¥${Math.round(usd * 150)})`);
