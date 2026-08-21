import fs from "node:fs";
import path from "node:path";

const [inputArg, outputArg, exitCodeArg] = process.argv.slice(2);
if (!inputArg || !outputArg || !exitCodeArg) {
  console.error(
    "usage: node scripts/sanitizeGitleaksReport.mjs <raw.json> <sanitized.json> <exit-code-file>",
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

const payload = {
  verified: exitCode === 0 && sanitized.length === 0,
  scanner_exit_code: exitCode,
  finding_count: sanitized.length,
  findings: sanitized,
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
