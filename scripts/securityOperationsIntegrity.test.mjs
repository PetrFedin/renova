import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const securityWorkflow = read(".github/workflows/security-operations.yml");
const codeqlWorkflow = read(".github/workflows/codeql.yml");
const backendImageWorkflow = read(".github/workflows/backend-image.yml");
const jsDependencyWorkflow = read(".github/workflows/js-dependency-integrity.yml");
const pythonEvaluator = read("scripts/evaluatePythonAudit.mjs");
const gitleaksSanitizer = read("scripts/sanitizeGitleaksReport.mjs");
const gitleaksConfig = read(".gitleaks.toml");
const operationsDoc = read("docs/SECURITY-OPERATIONS.md");
const prelaunchDoc = read("docs/PRELAUNCH-SECURITY-TEST.md");

const expectedGitleaksImage =
  "ghcr.io/gitleaks/gitleaks:v8.30.0@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9";

test("security tooling versions are exact and reviewed", () => {
  assert.equal(read("security/PIP_AUDIT_VERSION").trim(), "2.10.1");
  assert.equal(read("security/GITLEAKS_IMAGE").trim(), expectedGitleaksImage);
  assert.equal(securityWorkflow.includes("latest"), false);
  assert.equal(securityWorkflow.includes("pip-audit --fix"), false);
  assert.equal(securityWorkflow.includes("npm audit fix --force"), false);
});

test("Python audit materializes the exact production Poetry environment", () => {
  assert.match(securityWorkflow, /PYTHON_VERSION: "3\.12\.13"/);
  assert.match(securityWorkflow, /POETRY_VERSION: "2\.4\.1"/);
  assert.match(securityWorkflow, /actions\/checkout@v7/);
  assert.match(securityWorkflow, /actions\/setup-python@v7/);
  assert.match(securityWorkflow, /actions\/setup-node@v7/);
  assert.match(securityWorkflow, /poetry check --lock/);
  assert.match(securityWorkflow, /poetry sync --only main --no-root/);
  assert.match(securityWorkflow, /python -m pip check/);
  assert.match(securityWorkflow, /pip-audit[\s\S]*--path/);
  assert.match(securityWorkflow, /--vulnerability-service osv/);
  assert.match(securityWorkflow, /--aliases on/);
  assert.match(securityWorkflow, /--desc off/);
  assert.match(securityWorkflow, /--strict/);
  assert.match(securityWorkflow, /evaluatePythonAudit\.mjs/);
  assert.match(securityWorkflow, /python-audit-summary\.json/);
  assert.equal(securityWorkflow.includes("pip-audit.json\n"), false);
});

test("Python advisory exceptions are exact bounded reviewed and self-cleaning", () => {
  const baseline = JSON.parse(read("security/python-audit-baseline.json"));
  assert.equal(baseline.version, 1);
  assert.deepEqual(baseline.exceptions, []);
  assert.match(pythonEvaluator, /installed_version/);
  assert.match(pythonEvaluator, /vulnerability_id/);
  assert.match(pythonEvaluator, /review_issue/);
  assert.match(pythonEvaluator, /90 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(pythonEvaluator, /exception expired/);
  assert.match(pythonEvaluator, /stale exceptions/);
  assert.match(pythonEvaluator, /New or changed Python advisories require review/);
});

test("secret scanning covers full history, detects a canary and persists only sanitized evidence", () => {
  assert.match(securityWorkflow, /fetch-depth: 0/);
  assert.match(securityWorkflow, /gitleaks\/gitleaks:v8\.30\.0@sha256:/);
  assert.match(securityWorkflow, /Prove scanner detects a synthetic secret/);
  assert.match(securityWorkflow, /ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789/);
  assert.match(securityWorkflow, /Gitleaks canary was not detected/);
  assert.match(securityWorkflow, /git --no-banner --redact=100/);
  assert.match(securityWorkflow, /--config \/repo\/\.gitleaks\.toml/);
  assert.match(securityWorkflow, /--report-format json/);
  assert.match(securityWorkflow, /sanitizeGitleaksReport\.mjs/);
  assert.match(securityWorkflow, /rm -f .*gitleaks-raw\.json/);
  assert.match(securityWorkflow, /gitleaks-summary\.json/);
  assert.match(gitleaksSanitizer, /secret: "never persisted/);
  assert.match(gitleaksSanitizer, /match: "never persisted/);
  assert.equal(gitleaksSanitizer.includes("finding.Secret"), false);
  assert.equal(gitleaksSanitizer.includes("finding.Match"), false);
});

test("Gitleaks allowlist is restricted to one synthetic test key", () => {
  assert.match(gitleaksConfig, /useDefault = true/);
  assert.match(gitleaksConfig, /targetRules = \["generic-api-key"\]/);
  assert.match(gitleaksConfig, /condition = "AND"/);
  assert.match(gitleaksConfig, /backend\/tests\/test_esign_idempotency_key\\\.py/);
  assert.match(gitleaksConfig, /idempotency_key=\\?"renova-durable-intent-123\\?"/);
  assert.equal((gitleaksConfig.match(/\[\[allowlists\]\]/g) || []).length, 1);
  assert.equal(gitleaksConfig.includes("commits ="), false);
  assert.equal(gitleaksConfig.includes("stopwords ="), false);
});

test("CodeQL scans both application languages with current major line", () => {
  assert.match(codeqlWorkflow, /security-events: write/);
  assert.match(codeqlWorkflow, /github\/codeql-action\/init@v4/);
  assert.match(codeqlWorkflow, /github\/codeql-action\/analyze@v4/);
  assert.match(codeqlWorkflow, /- python/);
  assert.match(codeqlWorkflow, /- javascript-typescript/);
  assert.match(codeqlWorkflow, /build-mode: none/);
  assert.equal(codeqlWorkflow.includes("@latest"), false);
});

test("existing container and JavaScript advisory gates remain independent", () => {
  assert.match(backendImageWorkflow, /aquasecurity\/trivy-action@v0\.36\.0/);
  assert.match(backendImageWorkflow, /severity: CRITICAL,HIGH/);
  assert.match(backendImageWorkflow, /ignore-unfixed: true/);
  assert.match(backendImageWorkflow, /exit-code: "1"/);
  assert.match(jsDependencyWorkflow, /npm audit --omit=dev --json/);
  assert.match(jsDependencyWorkflow, /check-npm-audit-baseline\.mjs/);
  assert.match(jsDependencyWorkflow, /synthetic unapproved high advisory/);
});

test("security governance never equates CI with external readiness", () => {
  assert.match(operationsDoc, /protected: false/);
  assert.match(operationsDoc, /#247/);
  assert.match(operationsDoc, /#256/);
  assert.match(operationsDoc, /#257/);
  assert.match(operationsDoc, /NOT PROVEN \/ NOT READY/);
  assert.match(operationsDoc, /administrator review is therefore \*\*NOT PROVEN\*\*/);
  assert.match(operationsDoc, /external penetration\/abuse test: \*\*NOT EXECUTED\*\*/);
  assert.match(operationsDoc, /90 days/);
  assert.match(operationsDoc, /Least privilege/);
  assert.match(operationsDoc, /revoke or rotate/);
});

test("prelaunch abuse test remains explicitly unexecuted until evidence exists", () => {
  assert.match(prelaunchDoc, /Status: NOT EXECUTED/);
  assert.match(prelaunchDoc, /No external penetration-test proof is claimed/);
  assert.match(prelaunchDoc, /Authentication and session abuse/);
  assert.match(prelaunchDoc, /Authorization \/ IDOR \/ tenant isolation/);
  assert.match(prelaunchDoc, /WebSocket and realtime/);
  assert.match(prelaunchDoc, /Payments, refunds and webhook integrity/);
  assert.match(prelaunchDoc, /Documents, uploads and object storage/);
  assert.match(prelaunchDoc, /External-provider boundaries \/ SSRF \/ degradation/);
  assert.match(prelaunchDoc, /Background processing \/ concurrency/);
  assert.match(prelaunchDoc, /Mobile\/client abuse/);
  assert.match(prelaunchDoc, /Repository \/ supply-chain abuse/);
  assert.match(prelaunchDoc, /P0 \/ Critical/);
  assert.match(prelaunchDoc, /P1 \/ High/);
  assert.match(prelaunchDoc, /#238/);
  assert.match(prelaunchDoc, /#247/);
  assert.match(prelaunchDoc, /#257/);
});
