import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const loadDir = path.join(root, "load");
const workflowPath = path.join(root, ".github", "workflows", "load-slo-integrity.yml");
const docsPath = path.join(root, "docs", "LOAD-SLO.md");
const reconciliationPath = path.join(root, "scripts", "external-load-reconciliation.sh");
const samplerPath = path.join(root, "scripts", "external-capacity-sampler.py");
const evaluatorPath = path.join(root, "scripts", "external-capacity-evaluate.py");
const capacityServicePath = path.join(
  root,
  "backend",
  "app",
  "services",
  "capacity_runtime_service.py",
);
const runtimeTopologyPath = path.join(
  root,
  "backend",
  "app",
  "services",
  "runtime_topology.py",
);
const apiMainPath = path.join(root, "backend", "app", "main.py");
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

test("smoke load spike soak websocket and webhook scenarios exist", () => {
  for (const filename of [
    "k6-smoke.js",
    "k6-load.js",
    "k6-spike.js",
    "k6-soak.js",
    "k6-websocket.js",
    "k6-webhook-burst.js",
  ]) {
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

test("websocket capacity uses short-lived tickets and the real chat write path", () => {
  const source = read("load/k6-websocket.js");
  assert.match(source, /\/api\/v1\/auth\/ws-ticket/);
  assert.match(source, /\/ws\/chats\/\$\{fixture\.chat_thread_id\}\?ticket=/);
  assert.match(source, /POST \/api\/v1\/projects\/\{project_id\}\/chats\/\{thread_id\}\/messages \[ws fanout\]/);
  assert.match(source, /renova_ws_delivery_ms/);
  assert.match(source, /LOAD_ENABLE_WRITES=true/);
  assert.equal(source.includes("?token="), false);
});

test("webhook burst requires the staging provider secret without mutating payments", () => {
  const source = read("load/k6-webhook-burst.js");
  assert.match(source, /RENOVA_YOOKASSA_WEBHOOK_SECRET/);
  assert.match(source, /X-Webhook-Secret/);
  assert.match(source, /load\.capacity_probe/);
  assert.match(source, /business_applied === false/);
  assert.match(source, /ramping-arrival-rate/);
  assert.match(source, /eventSlot/);
});

test("k6 runtime is pinned to one immutable image", () => {
  assert.equal(read("load/K6_IMAGE").trim(), expectedK6Image);
  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.match(workflow, /K6_IMAGE: \$\{\{ steps\.k6-image\.outputs\.ref \}\}/);
  assert.match(workflow, /load\/K6_IMAGE/);
});

test("external staging load is protected release-bound and capacity-sampled", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /STAGING_API_BASE_URL/);
  assert.match(workflow, /STAGING_LOAD_TOKEN_POOL/);
  assert.match(workflow, /STAGING_ADMIN_BEARER_TOKEN/);
  assert.match(workflow, /STAGING_YOOKASSA_WEBHOOK_SECRET/);
  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /image_digest:/);
  assert.match(workflow, /external-staging-release-smoke\.sh/);
  assert.match(workflow, /external-capacity-sampler\.py/);
  assert.match(workflow, /external-capacity-evaluate\.py/);
  assert.match(workflow, /CAPACITY_MIN_API_INSTANCES: "2"/);
  assert.match(workflow, /external-load-reconciliation\.sh/);
  assert.match(workflow, /backend\/app\/services\/runtime_topology\.py/);
  assert.match(workflow, /backend\/app\/main\.py/);
});

test("shared API topology truth is independent of load-balancer routing", () => {
  const topology = fs.readFileSync(runtimeTopologyPath, "utf8");
  const main = fs.readFileSync(apiMainPath, "utf8");
  assert.match(topology, /API_REDIS_PREFIX = "renova:runtime:api:"/);
  assert.match(topology, /class ApiHeartbeatPublisher/);
  assert.match(topology, /async def api_heartbeat_loop/);
  assert.match(topology, /async def api_pool_snapshot/);
  assert.match(topology, /matching_release_instances/);
  assert.match(main, /ApiHeartbeatPublisher/);
  assert.match(main, /await api_heartbeat_publisher\.publish\(\)/);
  assert.match(main, /policy\.name in \{"staging", "production"\}/);
});

test("runtime capacity evidence is bounded and refuses invented infrastructure metrics", () => {
  const service = fs.readFileSync(capacityServicePath, "utf8");
  const sampler = fs.readFileSync(samplerPath, "utf8");
  const evaluator = fs.readFileSync(evaluatorPath, "utf8");
  assert.match(service, /configured_connection_capacity/);
  assert.match(service, /utilization_percent/);
  assert.match(service, /api_pool/);
  assert.match(service, /probe_latency_ms/);
  assert.match(service, /redis_utilization_available/);
  assert.match(service, /provider_cpu_memory_available/);
  assert.match(sampler, /capacity-samples\.ndjson/);
  assert.match(sampler, /\/api\/v1\/admin\/release-health/);
  assert.match(sampler, /_bounded_api_pool/);
  assert.match(sampler, /matching_release_instances/);
  assert.match(evaluator, /DB_POOL_MAX_PERCENT = 90\.0/);
  assert.match(evaluator, /DB_PROBE_P95_MAX_MS = 250\.0/);
  assert.match(evaluator, /REDIS_PROBE_P95_MAX_MS = 100\.0/);
  assert.match(evaluator, /api_artifact_mixed/);
  assert.match(evaluator, /worker_artifact_mixed/);
  assert.match(evaluator, /shared_api_heartbeat_registry/);
  assert.match(evaluator, /mixed_release_instances_allowed/);
  assert.match(evaluator, /redis_utilization_percent.*not_claimed/s);
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
  assert.match(docs, /WebSocket/);
  assert.match(docs, /webhook/i);
  assert.match(docs, /at least `2` live.*API/i);
  assert.match(docs, /shared.*API.*heartbeat.*Redis/i);
  assert.match(docs, /load balancer/i);
  assert.match(docs, /real external staging/i);
  assert.match(docs, /Redis utilization.*not.*claim/i);
});
