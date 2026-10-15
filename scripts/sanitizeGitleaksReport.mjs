import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const [inputArg, outputArg, exitCodeArg, baselineArg] = args;
if (!inputArg || !outputArg || !exitCodeArg || args.length > 4) {
  console.error("usage: node scripts/sanitizeGitleaksReport.mjs <raw.json> <sanitized.json> <exit-code-file> [history-baseline.json]");
  process.exit(2);
}

const output = path.resolve(outputArg);
const payload = {
  verified: false,
  scanner_exit_code: null,
  finding_count: 0,
  accepted_history_finding_count: 0,
  unexpected_finding_count: 0,
  baseline_version: null,
  findings: [],
  accepted_history_findings: [],
  error_code: null,
  redaction_policy: {
    secret: "never persisted in sanitized evidence",
    match: "never persisted in sanitized evidence",
    line_content: "never persisted in sanitized evidence",
  },
};

class EvidenceError extends Error {}
function fail(code) { throw new EvidenceError(code); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value, max, required = true) {
  return typeof value === "string" && value.length <= max &&
    (!required || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/u.test(value);
}

// Use an atomic replacement: a failed attempt must not retain a previous PASS.
// Renaming replaces an output symlink itself, never writes through its target.
function writeReceipt() {
  const temporary = fs.mkdtempSync(path.join(path.dirname(output), ".gitleaks-receipt-"));
  try {
    const file = path.join(temporary, "receipt.json");
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(file, output);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function readEvidence(file, limit, code) {
  let fd;
  try {
    fd = fs.openSync(path.resolve(file), fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || stat.size > limit) fail(code);
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    // Reject a changing file rather than accepting a truncated JSON prefix.
    if (length !== stat.size) fail(code);
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
  } catch {
    fail(code); // Do not echo parser/OS messages or raw scanner content.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function readJson(file, code) {
  try { return JSON.parse(readEvidence(file, 16 * 1024 * 1024, code)); }
  catch { fail(code); }
}
function alias(value, primary, legacy, fallback) {
  if (Object.hasOwn(value, primary) && Object.hasOwn(value, legacy) && value[primary] !== value[legacy]) {
    fail("INVALID_FINDING");
  }
  return value[primary] ?? value[legacy] ?? fallback;
}
function sanitize(finding) {
  if (!object(finding)) fail("INVALID_FINDING");
  const result = {
    rule_id: alias(finding, "RuleID", "rule_id"),
    description: alias(finding, "Description", "description", ""),
    file: alias(finding, "File", "file"),
    start_line: finding.StartLine,
    commit: alias(finding, "Commit", "commit", ""),
    fingerprint: alias(finding, "Fingerprint", "fingerprint", ""),
  };
  // Security identities must not be coerced or truncated into a baseline match.
  if (!text(result.rule_id, 120) || !text(result.file, 500) ||
      !text(result.description, 240, false) || !text(result.commit, 80, false) ||
      !text(result.fingerprint, 500, false) ||
      !Number.isSafeInteger(result.start_line) || result.start_line < 1) fail("INVALID_FINDING");
  return result;
}
function utcDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("INVALID_REVIEW_DATES");
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) fail("INVALID_REVIEW_DATES");
  return time;
}

try {
  // Never overwrite an evidence input by accidentally using it as the receipt.
  if ([inputArg, exitCodeArg, baselineArg].filter(Boolean).some((file) => path.resolve(file) === output)) {
    fail("OUTPUT_EQUALS_INPUT");
  }
  writeReceipt();
  const rawExit = readEvidence(exitCodeArg, 32, "INVALID_EXIT_CODE").trim();
  if (!/^[01]$/.test(rawExit)) fail("INVALID_EXIT_CODE");
  payload.scanner_exit_code = Number(rawExit);
  const findings = readJson(inputArg, "INVALID_REPORT");
  if (!Array.isArray(findings)) fail("INVALID_REPORT");
  payload.findings = findings.map(sanitize);
  payload.finding_count = findings.length;
  // This invariant is checked BEFORE any positive history-baseline verdict.
  if ((payload.scanner_exit_code === 0) !== (findings.length === 0)) fail("EXIT_REPORT_MISMATCH");

  if (baselineArg) {
    const baseline = readJson(baselineArg, "INVALID_BASELINE");
    if (!object(baseline) || baseline.version !== 1 || baseline.scope !== "merged-history-only" ||
        !Array.isArray(baseline.exceptions)) fail("INVALID_BASELINE");
    const reviewedAt = utcDay(baseline.reviewed_at);
    const reviewBy = utcDay(baseline.review_by);
    const today = utcDay(new Date().toISOString().slice(0, 10));
    if (reviewBy < reviewedAt || reviewedAt > today) fail("INVALID_REVIEW_DATES");
    if (reviewBy - reviewedAt > 90 * 24 * 60 * 60 * 1000) {
      fail("REVIEW_WINDOW_EXCEEDS_90_DAYS"); // review window exceeds 90 days
    }
    if (today > reviewBy) fail("REVIEW_EXPIRED");

    const exceptionMap = new Map();
    for (const exception of baseline.exceptions) {
      if (!object(exception) || !text(exception.fingerprint, 500) || !text(exception.rule_id, 120) ||
          !text(exception.file, 500) || !text(exception.commit, 80) ||
          !text(exception.classification, 120) || !text(exception.reason, 2000) ||
          !Number.isSafeInteger(exception.start_line) || exception.start_line < 1) fail("INVALID_BASELINE");
      if (exceptionMap.has(exception.fingerprint)) fail("DUPLICATE_BASELINE_FINGERPRINT");
      exceptionMap.set(exception.fingerprint, exception);
    }

    const seen = new Set();
    for (const finding of payload.findings) {
      const exception = exceptionMap.get(finding.fingerprint);
      if (!exception || exception.rule_id !== finding.rule_id || exception.file !== finding.file ||
          exception.commit !== finding.commit || exception.start_line !== finding.start_line) {
        payload.unexpected_finding_count += 1;
        continue;
      }
      if (seen.has(finding.fingerprint)) fail("DUPLICATE_REPORT_FINGERPRINT");
      seen.add(finding.fingerprint);
      payload.accepted_history_findings.push({
        fingerprint: finding.fingerprint, classification: exception.classification, reason: exception.reason,
      });
    }
    for (const fingerprint of exceptionMap.keys()) {
      if (!seen.has(fingerprint)) payload.unexpected_finding_count += 1;
    }
    payload.baseline_version = baseline.version;
    payload.accepted_history_finding_count = payload.accepted_history_findings.length;
    // Any unexpected or stale finding is a denial, not a broader allowlist.
    if (payload.unexpected_finding_count) fail("UNEXPECTED_OR_STALE_FINDING");
  } else if (findings.length !== 0) {
    fail("CURRENT_TREE_FINDINGS");
  }

  payload.verified = true;
  writeReceipt();
  console.log(baselineArg
    ? `gitleaks-history-gate: PASS accepted=${payload.accepted_history_finding_count} baseline_version=${payload.baseline_version}`
    : "gitleaks-gate: PASS findings=0");
} catch (error) {
  payload.verified = false;
  payload.error_code = error instanceof EvidenceError ? error.message : "EVIDENCE_IO_FAILURE";
  // Input/output alias is an operator error; do not destroy the input evidence.
  if (payload.error_code !== "OUTPUT_EQUALS_INPUT") {
    try { writeReceipt(); } catch { payload.error_code = "RECEIPT_WRITE_FAILED"; }
  }
  console.error(`FAIL: gitleaks evidence rejected (${payload.error_code})`);
  process.exitCode = 1;
}
