import fs from "node:fs";
import path from "node:path";

const [reportArg, baselineArg, exitCodeArg, summaryArg] = process.argv.slice(2);
if (!reportArg || !baselineArg || !exitCodeArg || !summaryArg) {
  console.error(
    "usage: node scripts/evaluatePythonAudit.mjs <report.json> <baseline.json> <exit-code-file> <summary.json>",
  );
  process.exit(2);
}

const reportPath = path.resolve(reportArg);
const baselinePath = path.resolve(baselineArg);
const exitCodePath = path.resolve(exitCodeArg);
const summaryPath = path.resolve(summaryArg);

function fail(message, details = []) {
  const summary = {
    verified: false,
    message,
    failures: details,
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.error(`FAIL: ${message}`);
  for (const item of details) console.error(`- ${item}`);
  process.exit(1);
}

function parseJson(file, label) {
  if (!fs.existsSync(file)) fail(`${label} file is missing: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON`, [String(error)]);
  }
}

function utcDay(value = new Date()) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function dateOnly(raw, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw || "")) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid`);
  return date;
}

const rawExit = fs.existsSync(exitCodePath)
  ? fs.readFileSync(exitCodePath, "utf8").trim()
  : "";
const auditExitCode = Number.parseInt(rawExit, 10);
if (!Number.isInteger(auditExitCode)) fail("pip-audit exit code is missing or invalid");
if (auditExitCode < 0 || auditExitCode > 1) {
  fail("pip-audit failed before a valid vulnerability result was produced", [
    `exit_code=${auditExitCode}`,
  ]);
}

const report = parseJson(reportPath, "pip-audit report");
const baseline = parseJson(baselinePath, "Python audit baseline");
if (baseline?.version !== 1 || !Array.isArray(baseline?.exceptions)) {
  fail("Python audit baseline must have version=1 and an exceptions array");
}

const dependencies = Array.isArray(report)
  ? report
  : Array.isArray(report?.dependencies)
    ? report.dependencies
    : null;
if (!dependencies) fail("pip-audit report does not contain a dependencies array");

// Some advisory feeds can return the same canonical advisory record more than once.
// Collapse only exact package/version/primary-id duplicates. Distinct advisory IDs are
// always preserved, while aliases and fix versions are unioned for policy matching.
const findingMap = new Map();
for (const dependency of dependencies) {
  if (!dependency || typeof dependency !== "object") continue;
  const packageName = String(dependency.name || "").trim().toLowerCase();
  const installedVersion = String(dependency.version || "").trim();
  const vulns = Array.isArray(dependency.vulns) ? dependency.vulns : [];
  for (const vuln of vulns) {
    if (!vuln || typeof vuln !== "object") continue;
    const vulnerabilityId = String(vuln.id || "").trim();
    const aliases = Array.isArray(vuln.aliases)
      ? vuln.aliases.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const fixVersions = Array.isArray(vuln.fix_versions)
      ? vuln.fix_versions.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (!packageName || !installedVersion || !vulnerabilityId) {
      fail("pip-audit returned an incomplete vulnerability record");
    }
    const key = `${packageName}\u0000${installedVersion}\u0000${vulnerabilityId}`;
    const existing = findingMap.get(key);
    if (existing) {
      for (const alias of aliases) existing.aliases.add(alias);
      for (const fixVersion of fixVersions) existing.fix_versions.add(fixVersion);
      continue;
    }
    findingMap.set(key, {
      package: packageName,
      installed_version: installedVersion,
      vulnerability_id: vulnerabilityId,
      aliases: new Set(aliases),
      fix_versions: new Set(fixVersions),
    });
  }
}

const findings = [...findingMap.values()].map((finding) => ({
  package: finding.package,
  installed_version: finding.installed_version,
  vulnerability_id: finding.vulnerability_id,
  aliases: [...finding.aliases].sort(),
  fix_versions: [...finding.fix_versions].sort(),
}));

const today = utcDay();
const maxExpiry = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
const baselineFailures = [];
const normalizedExceptions = [];
const seenKeys = new Set();

for (let index = 0; index < baseline.exceptions.length; index += 1) {
  const item = baseline.exceptions[index];
  const prefix = `exceptions[${index}]`;
  if (!item || typeof item !== "object") {
    baselineFailures.push(`${prefix}: must be an object`);
    continue;
  }
  const packageName = String(item.package || "").trim().toLowerCase();
  const installedVersion = String(item.installed_version || "").trim();
  const vulnerabilityId = String(item.vulnerability_id || "").trim();
  const reason = String(item.reason || "").trim();
  const reviewIssue = String(item.review_issue || "").trim();
  const expiresOn = String(item.expires_on || "").trim();
  const key = `${packageName}:${installedVersion}:${vulnerabilityId}`;

  if (!packageName) baselineFailures.push(`${prefix}: package is required`);
  if (!installedVersion) baselineFailures.push(`${prefix}: installed_version is required`);
  if (!vulnerabilityId) baselineFailures.push(`${prefix}: vulnerability_id is required`);
  if (reason.length < 20) baselineFailures.push(`${prefix}: reason must be at least 20 characters`);
  if (!/^#\d+$/.test(reviewIssue)) {
    baselineFailures.push(`${prefix}: review_issue must be a GitHub issue reference like #123`);
  }
  if (seenKeys.has(key)) baselineFailures.push(`${prefix}: duplicate exception ${key}`);
  seenKeys.add(key);

  try {
    const expiry = dateOnly(expiresOn, `${prefix}.expires_on`);
    if (expiry < today) baselineFailures.push(`${prefix}: exception expired on ${expiresOn}`);
    if (expiry > maxExpiry) {
      baselineFailures.push(`${prefix}: expiry must be no more than 90 days from review date`);
    }
  } catch (error) {
    baselineFailures.push(String(error.message || error));
  }

  normalizedExceptions.push({
    package: packageName,
    installed_version: installedVersion,
    vulnerability_id: vulnerabilityId,
    reason,
    review_issue: reviewIssue,
    expires_on: expiresOn,
  });
}

if (baselineFailures.length) fail("Python advisory baseline is invalid", baselineFailures);

const used = new Set();
const unapproved = [];
for (const finding of findings) {
  const ids = new Set([finding.vulnerability_id, ...finding.aliases]);
  const matchIndex = normalizedExceptions.findIndex(
    (exception) =>
      exception.package === finding.package &&
      exception.installed_version === finding.installed_version &&
      ids.has(exception.vulnerability_id),
  );
  if (matchIndex < 0) {
    unapproved.push(
      `${finding.package}@${finding.installed_version} ${finding.vulnerability_id}` +
        (finding.fix_versions.length ? ` fixes=${finding.fix_versions.join(",")}` : " fixes=unavailable"),
    );
  } else {
    used.add(matchIndex);
  }
}

const stale = normalizedExceptions
  .map((exception, index) => ({ exception, index }))
  .filter(({ index }) => !used.has(index))
  .map(
    ({ exception }) =>
      `${exception.package}@${exception.installed_version} ${exception.vulnerability_id}`,
  );

if (stale.length) fail("Python advisory baseline contains stale exceptions", stale);
if (unapproved.length) fail("New or changed Python advisories require review", unapproved);
if (auditExitCode === 0 && findings.length > 0) {
  fail("pip-audit exit code/report disagree: findings exist with exit code 0");
}
if (auditExitCode === 1 && findings.length === 0) {
  fail("pip-audit exit code/report disagree: exit code 1 without findings");
}

const summary = {
  verified: true,
  audit_exit_code: auditExitCode,
  findings: findings.map((finding) => ({
    package: finding.package,
    installed_version: finding.installed_version,
    vulnerability_id: finding.vulnerability_id,
    aliases: finding.aliases,
    fix_versions: finding.fix_versions,
    exception: normalizedExceptions.find((exception) => {
      const ids = new Set([finding.vulnerability_id, ...finding.aliases]);
      return (
        exception.package === finding.package &&
        exception.installed_version === finding.installed_version &&
        ids.has(exception.vulnerability_id)
      );
    }) || null,
  })),
  exception_count: normalizedExceptions.length,
  policy: {
    exception_max_days: 90,
    exact_installed_version_required: true,
    review_issue_required: true,
    stale_exceptions_fail: true,
    exact_primary_id_duplicates_collapsed: true,
  },
};
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(
  `python-advisory-gate: PASS findings=${findings.length} exceptions=${normalizedExceptions.length}`,
);
