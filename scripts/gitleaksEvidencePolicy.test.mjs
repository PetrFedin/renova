import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = process.env.SANITIZER_PATH || fileURLToPath(new URL("./sanitizeGitleaksReport.mjs", import.meta.url));
const sentinel = "private-content-must-not-be-echoed";
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const finding = () => ({ RuleID: "fixture-rule", Description: "Ordinary fixture", File: "docs/fixture.md", StartLine: 12,
  Commit: "a".repeat(40), Fingerprint: `${"a".repeat(40)}:docs/fixture.md:fixture-rule:12`,
  Secret: sentinel, Match: sentinel, Line: sentinel });
const baseline = () => ({ version: 1, scope: "merged-history-only", reviewed_at: day(-1), review_by: day(30),
  exceptions: [{ fingerprint: finding().Fingerprint, rule_id: "fixture-rule", file: "docs/fixture.md",
    commit: "a".repeat(40), start_line: 12, classification: "synthetic-fixture", reason: "No credential; contract test only" }] });

function run(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "renova-gitleaks-evidence-"));
  try {
    const input = path.join(dir, "raw.json");
    const output = path.join(dir, "receipt.json");
    const exit = path.join(dir, "exit.txt");
    const base = path.join(dir, "baseline.json");
    if (!options.missingReport) fs.writeFileSync(input, options.raw ?? JSON.stringify(options.findings ?? []));
    if (!options.missingExit) fs.writeFileSync(exit, options.exit ?? "0\n");
    if (options.baseline !== undefined) fs.writeFileSync(base, options.rawBaseline ?? JSON.stringify(options.baseline));
    if (options.stale) fs.writeFileSync(output, JSON.stringify({ verified: true, old: true }));
    options.setup?.({ dir, input, output, exit, base });
    const result = spawnSync(process.execPath, [script, input, output, exit,
      ...(options.baseline !== undefined ? [base] : [])], { encoding: "utf8", timeout: 5000 });
    let receipt = null;
    if (fs.existsSync(output) && fs.statSync(output).isFile()) receipt = JSON.parse(fs.readFileSync(output, "utf8"));
    return { ...result, receipt, serialized: receipt ? JSON.stringify(receipt) : "" };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function denied(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.receipt?.verified, false, "denial must replace any stale positive receipt");
  assert.equal(result.receipt?.old, undefined);
  assert.doesNotMatch(result.stdout, /PASS/);
  assert.equal(`${result.stdout}${result.stderr}${result.serialized}`.includes(sentinel), false);
}
function passed(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.receipt?.verified, true);
  assert.match(result.stdout, /PASS/);
}

test("clean scanner report is required and accepted", () => passed(run()));
test("clean report replaces a stale receipt", () => passed(run({ stale: true })));
test("a real current-tree finding is denied without secret contents", () => denied(run({ findings: [finding()], exit: "1" })));
test("exact reviewed history finding is admitted and redacted", () => {
  const result = run({ findings: [finding()], exit: "1", baseline: baseline() });
  passed(result);
  assert.equal(result.receipt.accepted_history_finding_count, 1);
  assert.equal(result.serialized.includes(sentinel), false);
});
test("an empty historical baseline can attest a real empty report", () => {
  const base = baseline(); base.exceptions = [];
  passed(run({ baseline: base }));
});

for (const [name, options] of [
  ["missing report", { missingReport: true }], ["zero-byte report", { raw: "" }],
  ["blank report", { raw: " \n" }], ["missing exit", { missingExit: true }],
  ["invalid JSON", { raw: `[{${sentinel}` }], ["null report", { raw: "null" }],
  ["object report", { raw: "{}" }], ["null finding", { findings: [null], exit: "1" }],
  ["primitive finding", { findings: [sentinel], exit: "1" }],
  ["incomplete finding", { findings: [{}], exit: "1" }],
  ["success with findings", { findings: [finding()], exit: "0" }],
  ["finding status with empty report", { exit: "1" }],
]) test(`fail closed: ${name}`, () => denied(run({ ...options, stale: true })));

for (const exit of ["0trailing", "1trailing", "0.5", "1.5", "00", "+0", "-0", "2", "-1", "", "NaN", "0\n1"]) {
  test(`exit evidence is an exact integer: ${JSON.stringify(exit)}`, () => denied(run({ exit, stale: true })));
}
for (const [exit, findings] of [["0", [finding()]], ["1", []]]) {
  test(`history receipt cannot contradict scanner exit ${exit}`, () => {
    const base = baseline(); if (!findings.length) base.exceptions = [];
    denied(run({ findings, exit, baseline: base, stale: true }));
  });
}
for (const [name, change] of [
  ["rule", (f) => { f.RuleID = "other-rule"; }], ["path", (f) => { f.File = "other.md"; }],
  ["commit", (f) => { f.Commit = "b".repeat(40); }], ["line", (f) => { f.StartLine = 13; }],
  ["fingerprint", (f) => { f.Fingerprint += ":changed"; }],
  ["oversized fingerprint", (f) => { f.Fingerprint = "f".repeat(501); }],
  ["ambiguous alias", (f) => { f.rule_id = "other-rule"; }],
]) test(`history exact-match invariant: ${name}`, () => {
  const f = finding(); change(f);
  denied(run({ findings: [f], exit: "1", baseline: baseline() }));
});
for (const [name, change] of [
  ["expired", (b) => { b.reviewed_at = day(-3); b.review_by = day(-1); }],
  ["overlong", (b) => { b.review_by = day(100); }],
  ["future review", (b) => { b.reviewed_at = day(1); }],
  ["reversed dates", (b) => { b.reviewed_at = day(-1); b.review_by = day(-2); }],
  ["invalid date", (b) => { b.reviewed_at = "2026-02-30"; }],
  ["invalid scope", (b) => { b.scope = "current-tree"; }],
  ["invalid version", (b) => { b.version = 2; }],
  ["duplicate exception", (b) => { b.exceptions.push({ ...b.exceptions[0] }); }],
  ["string line", (b) => { b.exceptions[0].start_line = "12"; }],
  ["null exception", (b) => { b.exceptions = [null]; }],
  ["missing reason", (b) => { delete b.exceptions[0].reason; }],
]) test(`history baseline validation: ${name}`, () => {
  const b = baseline(); change(b);
  denied(run({ findings: [finding()], exit: "1", baseline: b, stale: true }));
});
test("stale history exception fails closed", () => denied(run({ baseline: baseline(), stale: true })));
test("duplicate report fingerprint is denied", () => denied(run({ findings: [finding(), finding()], exit: "1", baseline: baseline() })));
test("malformed baseline never echoes raw parser contents", () => denied(run({ findings: [finding()], exit: "1", baseline: {}, rawBaseline: `{${sentinel}`, stale: true })));
test("null baseline produces a denied receipt", () => denied(run({ findings: [finding()], exit: "1", baseline: null, stale: true })));
test("review expiring today is valid until the end of UTC day", () => {
  const b = baseline(); b.review_by = day(0);
  passed(run({ findings: [finding()], exit: "1", baseline: b }));
});
test("directory is not scanner evidence", () => denied(run({ missingReport: true, stale: true,
  setup: ({ input }) => fs.mkdirSync(input) })));
test("invalid UTF-8 is rejected", () => denied(run({ setup: ({ input }) => fs.writeFileSync(input, Buffer.from([0xff, 0xfe])), stale: true })));
test("unwritable receipt fails without a successful verdict", () => {
  const result = run({ setup: ({ output }) => fs.mkdirSync(output) });
  assert.equal(result.status, 1); assert.doesNotMatch(result.stdout, /PASS/);
  assert.equal(result.receipt, null);
});

test("documented lowercase identity aliases remain compatible", () => {
  const f = finding();
  for (const [primary, legacy] of [["RuleID", "rule_id"], ["File", "file"], ["Commit", "commit"], ["Fingerprint", "fingerprint"]]) {
    f[legacy] = f[primary]; delete f[primary];
  }
  passed(run({ findings: [f], exit: "1", baseline: baseline() }));
});
test("ordinary CRLF exit file is accepted", () => passed(run({ exit: "0\r\n" })));
test("symlink scanner input fails closed where no-follow is supported", { skip: !fs.constants.O_NOFOLLOW }, () => {
  denied(run({ missingReport: true, stale: true, setup: ({ input, dir }) => {
    const target = path.join(dir, "target.json"); fs.writeFileSync(target, "[]"); fs.symlinkSync(target, input);
  } }));
});
test("an output symlink is replaced without modifying its target", { skip: process.platform === "win32" }, () => {
  let target;
  const result = run({ setup: ({ output, dir }) => {
    target = path.join(os.tmpdir(), `renova-receipt-target-${path.basename(dir)}`);
    fs.writeFileSync(target, "original"); fs.symlinkSync(target, output);
  } });
  try { passed(result); assert.equal(fs.readFileSync(target, "utf8"), "original"); }
  finally { fs.rmSync(target, { force: true }); }
});
test("named pipes are refused without blocking", { skip: process.platform === "win32" }, () => {
  denied(run({ missingReport: true, stale: true, setup: ({ input }) => {
    const result = spawnSync("mkfifo", [input], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } }));
});

const workflowFile = process.env.GITLEAKS_WORKFLOW_PATH || fileURLToPath(new URL("../.github/workflows/security-operations.yml", import.meta.url));
const workflow = fs.readFileSync(workflowFile, "utf8");
test("workflow never fabricates empty scanner evidence", () => assert.doesNotMatch(workflow, /printf '\[\]/));
test("existing security job executes the behavioral evidence tests", () => assert.match(workflow, /node --test scripts\/gitleaksEvidencePolicy\.test\.mjs/));
test("pinned scanner must produce a real clean report as well as detect a leak", () => {
  assert.match(workflow, /Prove scanner detects a synthetic secret/);
  assert.match(workflow, /Prove scanner writes a real clean JSON report/);
  assert.match(workflow, /--report-path \/out\/gitleaks-clean-raw\.json/);
  assert.match(workflow, /sanitizeGitleaksReport\.mjs[\s\S]*gitleaks-clean-raw\.json/);
});
test("both scan paths clear stale evidence before invoking the scanner", () => {
  for (const kind of ["history", "tree"]) {
    assert.match(workflow, new RegExp(`rm -f "\\$RUNNER_TEMP/renova-security/gitleaks-${kind}-raw\\.json"[\\s\\S]*gitleaks-${kind}-summary\\.json"\\n[ ]+set \\+e`));
  }
});
