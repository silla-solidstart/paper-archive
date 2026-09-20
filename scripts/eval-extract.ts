/**
 * Extraction evaluation harness — for tuning the prompt on the real corpus.
 *
 * Runs every image/PDF in a folder through a running dev server's
 * /api/process and prints one line per document, then writes the full
 * responses to an output folder so two prompt versions can be diffed.
 *
 *   scripts/dev.sh                      # in another terminal
 *   node scripts/eval-extract.ts ~/scans/corpus [out-dir]
 *
 * The bearer token is read from APP_BEARER_TOKEN, or from Secret Manager via
 * gcloud. Every run bills Document AI and Claude; the corpus size is the cap.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const [, , corpusDir, outDir = `eval-out/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`] = process.argv;
if (!corpusDir) {
  console.error("usage: node scripts/eval-extract.ts <corpus-dir> [out-dir]");
  process.exit(2);
}
const BASE = process.env.PA_BASE_URL ?? "http://localhost:8787";
const PROJECT = "solidstart-paper-archive";

function token(): string {
  if (process.env.APP_BEARER_TOKEN) return process.env.APP_BEARER_TOKEN;
  return execFileSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", "--secret=APP_BEARER_TOKEN", `--project=${PROJECT}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" };

const files = readdirSync(corpusDir).filter((f) => MIME[path.extname(f).toLowerCase()]).sort();
if (!files.length) {
  console.error(`no images or PDFs in ${corpusDir}`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const auth = `Bearer ${token()}`;
const pad = (s: unknown, n: number) => String(s ?? "").padEnd(n).slice(0, n);
console.log(pad("file", 28), pad("type", 16), pad("date", 10), pad("amount", 10), pad("action", 10), pad("retention", 18), "title");

let ok = 0, failed = 0;
for (const f of files) {
  const mime = MIME[path.extname(f).toLowerCase()];
  const body = readFileSync(path.join(corpusDir, f));
  const started = Date.now();
  try {
    // dry=1: OCR + extraction only; nothing is indexed or filed (operator path).
    const res = await fetch(`${BASE}/api/process?dry=1&sync=1`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": mime, "X-Filename": encodeURIComponent(f) },
      body,
    });
    const json = (await res.json()) as Record<string, unknown>;
    writeFileSync(path.join(outDir, f + ".json"), JSON.stringify(json, null, 2));
    if (!res.ok) {
      failed++;
      console.log(pad(f, 28), `FAILED ${res.status} ${JSON.stringify(json).slice(0, 80)}`);
      continue;
    }
    ok++;
    const x = json.extraction as Record<string, unknown>;
    console.log(
      pad(f, 28), pad(x.document_type, 16), pad(x.document_date, 10),
      pad(x.amount != null ? `${x.currency ?? ""}${x.amount}` : "", 10),
      pad(x.action_required ? x.action_date ?? "yes" : "", 10),
      pad(x.retention, 18), `${x.title}  (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
  } catch (err) {
    failed++;
    console.log(pad(f, 28), `ERROR ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`\n${ok} ok, ${failed} failed. Full responses in ${outDir}/`);
console.log("Compare two runs:  diff <(jq -S .extraction A/x.json) <(jq -S .extraction B/x.json)");
