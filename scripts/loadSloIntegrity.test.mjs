import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const loadDir = path.join(root, "load");
const workflowPath = path.join(root, ".github", "workflows", "load-slo-integrity.yml");
const docsPath = path.join(root, "docs", "LOAD-SLO.md");
const reconciliationPath = path.join(root, "scripts", "external-load-reconciliation.sh");
const expectedK6Image =
  "grafana/k6:2.1.0@sha256:65c920dc067d5e2e00befbf982af6ad6ad0117034e8b1c65817c7975c52d4669";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("load suite bans demo and header-auth regressions", () => {
  for (const file of jsFiles(loadDir)) {
    const source = fs.readFileSync(file, "utf8");
    assert.equal(source.includes("/auth/demo"), false, file);
    assert.equal(source.includes("X-User-Id"), false, file);
    assert.equal(source.includes("127.0.0.1"), false, file);
    assert.equal(source.includes("localhost"), false, file);
  }
});

test("load identities are bearer tokens supplied out of band", () => {
  const config = read("load/lib/config.js");
  const journey = read("load/lib/journey.js");
  assert.match(config, /API_BASE_URL/);
  assert.match(config, /RENOVA_LOAD_TOKEN_POOL/);
  assert.match(config, /Authorization/);
  assert.match(config, /Bearer/);
  assert.match(journey, /GET \/api\/v1\/projects/);
  assert.match(journey, /GET \/api\/v1\/projects\/\{project_id\}\/dashboard/);
  assert.match(journey, /POST \/api\/v1\/projects\/\{project_id\}\/chats\/\{thread_id\}\/messages/);
});

test("launch-candidate thresholds are explicit and shared", () => {
  const config = read("load/lib/config.js");
  assert.match(config, /rate<0\.01/);
  assert.match(config, /p\(95\)<1000/);
  assert.match(config, /p\(99\)<2500/);
  assert.match(config, /renova_journey_failed/);
});

test("smoke load spike and soak scenarios exist", () => {
  for (const filename of ["k6-smoke.js", "k6-load.js", "k6-spike.js", "k6-soak.js"]) {
    assert.equal(fs.existsSync(path.join(loadDir, filename)), true, filename);
  }
});

test("writes are bounded and require dedicated fixture ids", () => {
  const config = read("load/lib/config.js");
  const journey = read("load/lib/journey.js");
  assert.match(config, /LOAD_ENABLE_WRITES/);
  assert.match(config, /LOAD_WRITE_EVERY/);
  assert.match(config, /LOAD_MAX_WRITES_PER_VU/);
  assert.match(config, /project_id and chat_thread_id/);
  assert.match(journey, /writeSlot < config\.maxWritesPerVu/);
});

test("k6 runtime is pinned to one immutable image", () => {
  assert.equal(read("load/K6_IMAGE").trim(), expectedK6Image);
  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.match(workflow, /K6_IMAGE: \$\{\{ steps\.k6-image\.outputs\.ref \}\}/);
  assert.match(workflow, /load\/K6_IMAGE/);
});

test("external staging load is protected and release-bound", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /STAGING_API_BASE_URL/);
  assert.match(workflow, /STAGING_LOAD_TOKEN_POOL/);
  assert.match(workflow, /STAGING_ADMIN_BEARER_TOKEN/);
  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /image_digest:/);
  assert.match(workflow, /external-staging-release-smoke\.sh/);
  assert.match(workflow, /external-load-reconciliation\.sh/);
});

test("post-load reconciliation fails on outbox poison stale lease or age", () => {
  const source = fs.readFileSync(reconciliationPath, "utf8");
  assert.match(source, /poisoned/);
  assert.match(source, /stale_leases/);
  assert.match(source, /oldest_pending_age_seconds/);
  assert.match(source, /<= 300/);
});

test("documentation keeps capacity truth explicit", () => {
  const docs = fs.readFileSync(docsPath, "utf8");
  assert.match(docs, /NOT PROVEN/);
  assert.match(docs, /candidate thresholds/);
  assert.match(docs, /Bearer/);
  assert.match(docs, /real external staging/i);
});
