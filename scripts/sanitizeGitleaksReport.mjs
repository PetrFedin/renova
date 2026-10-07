import fs from "node:fs";
import path from "node:path";

const [inputArg, outputArg, exitCodeArg, baselineArg] = process.argv.slice(2);
if (!inputArg || !outputArg || !exitCodeArg) {
  console.error(
    "usage: node scripts/sanitizeGitleaksReport.mjs <raw.json> <sanitized.json> <exit-code-file> [history-baseline.json]",
  );
  process.exit(2);
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const exitCodeFile = path.resolve(exitCodeArg);
const rawExit = fs.existsSync(exitCodeFile)
  ? fs.readFileSync(exitCodeFile, "utf8").trim()
  : "";
const exitCode = Number.parseInt(rawExit, 10);
if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 1) {
  console.error(`FAIL: invalid gitleaks exit code: ${rawExit || "missing"}`);
  process.exit(1);
}

let findings = [];
if (fs.existsSync(input) && fs.statSync(input).size > 0) {
  try {
    const parsed = JSON.parse(fs.readFileSync(input, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("report root must be an array");
    findings = parsed;
  } catch (error) {
    console.error(`FAIL: gitleaks report is invalid JSON: ${error}`);
    process.exit(1);
  }
}

const sanitized = findings.map((finding) => ({
  rule_id: String(finding.RuleID || finding.rule_id || "unknown").slice(0, 120),
  description: String(finding.Description || finding.description || "").slice(0, 240),
  file: String(finding.File || finding.file || "").slice(0, 500),
  start_line: Number.isInteger(finding.StartLine) ? finding.StartLine : null,
  commit: String(finding.Commit || finding.commit || "").slice(0, 80),
  fingerprint: String(finding.Fingerprint || finding.fingerprint || "").slice(0, 500),
}));

let accepted = [];
let blockers = [];
let baselineVersion = null;

if (baselineArg) {
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(path.resolve(baselineArg), "utf8"));
  } catch (error) {
    console.error(`FAIL: cannot parse gitleaks history baseline: ${error}`);
    process.exit(1);
  }

  if (baseline.version !== 1 || baseline.scope !== "merged-history-only") {
    console.error("FAIL: unsupported gitleaks history baseline contract");
    process.exit(1);
  }
  if (!Array.isArray(baseline.exceptions)) {
    console.error("FAIL: gitleaks history baseline exceptions must be an array");
    process.exit(1);
  }

  const reviewedAt = Date.parse(`${baseline.reviewed_at}T00:00:00Z`);
  const reviewBy = Date.parse(`${baseline.review_by}T00:00:00Z`);
  if (!Number.isFinite(reviewedAt) || !Number.isFinite(reviewBy) || reviewBy < reviewedAt) {
    console.error("FAIL: invalid gitleaks history baseline review dates");
    process.exit(1);
  }
  if (reviewBy - reviewedAt > 90 * 24 * 60 * 60 * 1000) {
    console.error("FAIL: gitleaks history baseline review window exceeds 90 days");
    process.exit(1);
  }
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (today > reviewBy) {
    console.error(`FAIL: gitleaks history baseline review expired on ${baseline.review_by}`);
    process.exit(1);
  }

  const exceptionMap = new Map();
  for (const exception of baseline.exceptions) {
    const required = ["fingerprint", "rule_id", "file", "commit", "classification", "reason"];
    if (required.some((key) => !String(exception?.[key] ?? "").trim())) {
      console.error("FAIL: incomplete gitleaks history baseline exception");
      process.exit(1);
    }
    if (exceptionMap.has(exception.fingerprint)) {
      console.error(`FAIL: duplicate gitleaks history fingerprint ${exception.fingerprint}`);
      process.exit(1);
    }
    exceptionMap.set(exception.fingerprint, exception);
  }

  const seen = new Set();
  for (const finding of sanitized) {
    const exception = exceptionMap.get(finding.fingerprint);
    if (
      !exception ||
      exception.rule_id !== finding.rule_id ||
      exception.file !== finding.file ||
      exception.commit !== finding.commit ||
      Number(exception.start_line) !== finding.start_line
    ) {
      blockers.push(finding);
      continue;
    }
    seen.add(finding.fingerprint);
    accepted.push({
      fingerprint: finding.fingerprint,
      classification: exception.classification,
      reason: exception.reason,
    });
  }

  for (const fingerprint of exceptionMap.keys()) {
    if (!seen.has(fingerprint)) {
      blockers.push({
        rule_id: "stale-baseline",
        file: exceptionMap.get(fingerprint).file,
        start_line: exceptionMap.get(fingerprint).start_line,
        commit: exceptionMap.get(fingerprint).commit,
        fingerprint,
      });
    }
  }
  baselineVersion = baseline.version;
}

const verified =
  baselineArg
    ? blockers.length === 0 && sanitized.length === accepted.length
    : exitCode === 0 && sanitized.length === 0;

const payload = {
  verified,
  scanner_exit_code: exitCode,
  finding_count: sanitized.length,
  accepted_history_finding_count: accepted.length,
  unexpected_finding_count: blockers.length,
  baseline_version: baselineVersion,
  findings: sanitized,
  accepted_history_findings: accepted,
  redaction_policy: {
    secret: "never persisted in sanitized evidence",
    match: "never persisted in sanitized evidence",
    line_content: "never persisted in sanitized evidence",
  },
};
fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

if (exitCode === 0 && sanitized.length !== 0) {
  console.error("FAIL: gitleaks reported success but findings are present");
  process.exit(1);
}
if (exitCode === 1 && sanitized.length === 0) {
  console.error("FAIL: gitleaks reported findings but the report is empty");
  process.exit(1);
}

if (baselineArg) {
  if (blockers.length) {
    console.error(`FAIL: gitleaks history has ${blockers.length} unexpected or stale finding(s)`);
    for (const finding of blockers) {
      console.error(
        `- ${finding.rule_id} ${finding.file}:${finding.start_line ?? "?"} commit=${finding.commit || "working-tree"} fingerprint=${finding.fingerprint}`,
      );
    }
    process.exit(1);
  }
  console.log(
    `gitleaks-history-gate: PASS accepted=${accepted.length} baseline_version=${baselineVersion}`,
  );
  process.exit(0);
}

if (exitCode === 1) {
  console.error(`FAIL: gitleaks found ${sanitized.length} potential secret(s)`);
  for (const finding of sanitized) {
    console.error(
      `- ${finding.rule_id} ${finding.file}:${finding.start_line ?? "?"} commit=${finding.commit || "working-tree"}`,
    );
  }
  process.exit(1);
}
console.log("gitleaks-gate: PASS findings=0");
