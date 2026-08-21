import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const evaluator = path.resolve("scripts/evaluatePythonAudit.mjs");

function day(offsetDays) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function runPolicy({ report, baseline, auditExitCode }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "renova-python-audit-"));
  try {
    const reportPath = path.join(dir, "report.json");
    const baselinePath = path.join(dir, "baseline.json");
    const exitPath = path.join(dir, "exit.txt");
    const summaryPath = path.join(dir, "summary.json");
    fs.writeFileSync(reportPath, `${JSON.stringify(report)}\n`, "utf8");
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline)}\n`, "utf8");
    fs.writeFileSync(exitPath, `${auditExitCode}\n`, "utf8");

    const result = spawnSync(
      process.execPath,
      [evaluator, reportPath, baselinePath, exitPath, summaryPath],
      { encoding: "utf8" },
    );
    const summary = fs.existsSync(summaryPath)
      ? JSON.parse(fs.readFileSync(summaryPath, "utf8"))
      : null;
    return { ...result, summary };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function findingReport({ version = "1.0.0", id = "GHSA-test-0000-0000", aliases = [] } = {}) {
  return {
    dependencies: [
      {
        name: "example-package",
        version,
        vulns: [
          {
            id,
            aliases,
            fix_versions: ["1.0.1"],
          },
        ],
      },
    ],
  };
}

const emptyBaseline = { version: 1, exceptions: [] };

test("clean Python audit with empty baseline passes", () => {
  const result = runPolicy({
    report: { dependencies: [] },
    baseline: emptyBaseline,
    auditExitCode: 0,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.verified, true);
  assert.equal(result.summary.exception_count, 0);
  assert.deepEqual(result.summary.findings, []);
});

test("new Python advisory fails when baseline is empty", () => {
  const result = runPolicy({
    report: findingReport(),
    baseline: emptyBaseline,
    auditExitCode: 1,
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.summary.verified, false);
  assert.match(result.summary.message, /New or changed Python advisories require review/);
  assert.match(result.summary.failures.join("\n"), /example-package@1\.0\.0 GHSA-test-0000-0000/);
});

test("exact reviewed unexpired exception permits only its exact finding", () => {
  const baseline = {
    version: 1,
    exceptions: [
      {
        package: "example-package",
        installed_version: "1.0.0",
        vulnerability_id: "CVE-2099-0001",
        reason: "Upstream fix is incompatible with the reviewed runtime until the linked remediation lands.",
        review_issue: "#237",
        expires_on: day(30),
      },
    ],
  };
  const result = runPolicy({
    report: findingReport({ aliases: ["CVE-2099-0001"] }),
    baseline,
    auditExitCode: 1,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.verified, true);
  assert.equal(result.summary.exception_count, 1);
  assert.equal(result.summary.findings[0].exception.review_issue, "#237");
});

test("exception does not survive package-version drift", () => {
  const baseline = {
    version: 1,
    exceptions: [
      {
        package: "example-package",
        installed_version: "0.9.9",
        vulnerability_id: "GHSA-test-0000-0000",
        reason: "Temporary exact-version exception retained only for synthetic policy validation.",
        review_issue: "#237",
        expires_on: day(30),
      },
    ],
  };
  const result = runPolicy({
    report: findingReport({ version: "1.0.0" }),
    baseline,
    auditExitCode: 1,
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.summary.verified, false);
});

test("stale exception fails after the finding disappears", () => {
  const baseline = {
    version: 1,
    exceptions: [
      {
        package: "example-package",
        installed_version: "1.0.0",
        vulnerability_id: "GHSA-test-0000-0000",
        reason: "Temporary exact finding used only to verify stale baseline cleanup behavior.",
        review_issue: "#237",
        expires_on: day(30),
      },
    ],
  };
  const result = runPolicy({
    report: { dependencies: [] },
    baseline,
    auditExitCode: 0,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.summary.message, /stale exceptions/);
});

test("expired or overlong exception fails baseline validation", () => {
  for (const expiresOn of [day(-1), day(91)]) {
    const baseline = {
      version: 1,
      exceptions: [
        {
          package: "example-package",
          installed_version: "1.0.0",
          vulnerability_id: "GHSA-test-0000-0000",
          reason: "Temporary exact finding used only to verify exception expiry boundaries.",
          review_issue: "#237",
          expires_on: expiresOn,
        },
      ],
    };
    const result = runPolicy({
      report: findingReport(),
      baseline,
      auditExitCode: 1,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.summary.message, /baseline is invalid/);
  }
});

test("scanner failure cannot be interpreted as a clean audit", () => {
  const result = runPolicy({
    report: { dependencies: [] },
    baseline: emptyBaseline,
    auditExitCode: 2,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.summary.message, /failed before a valid vulnerability result/);
});
