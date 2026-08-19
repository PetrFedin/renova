import fs from 'node:fs';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('usage: node scripts/check-npm-audit-baseline.mjs <npm-audit.json>');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`cannot parse npm audit report ${reportPath}: ${error.message}`);
  process.exit(2);
}

if (report.error) {
  console.error(`npm audit returned an error payload: ${JSON.stringify(report.error)}`);
  process.exit(2);
}

const allowedHigh = new Map([
  [
    'GHSA-w3rx-r6r6-pgpr',
    {
      package: 'image-size',
      severity: 'high',
      reviewBy: '2026-10-31',
      reason: 'Metro build-time ICNS parser DoS; upstream has no patched release.',
    },
  ],
  [
    'GHSA-5p2g-fcmc-qvqq',
    {
      package: 'image-size',
      severity: 'high',
      reviewBy: '2026-10-31',
      reason: 'Metro build-time JXL/HEIF parser DoS; upstream has no patched release.',
    },
  ],
]);

const advisories = [];
const seen = new Set();
for (const [nodeName, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vulnerability?.via ?? []) {
    if (!via || typeof via !== 'object') continue;
    const match = String(via.url ?? '').match(/github\.com\/advisories\/(GHSA-[A-Za-z0-9-]+)/i);
    const advisoryId = match?.[1] ?? `npm-source-${via.source ?? 'unknown'}`;
    const key = `${advisoryId}:${via.name ?? nodeName}:${via.severity ?? vulnerability.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    advisories.push({
      id: advisoryId,
      package: via.name ?? nodeName,
      severity: String(via.severity ?? vulnerability.severity ?? 'unknown').toLowerCase(),
      title: via.title ?? '',
      range: via.range ?? vulnerability.range ?? '',
    });
  }
}

const blockers = [];
const accepted = [];
const today = new Date().toISOString().slice(0, 10);
for (const advisory of advisories) {
  if (advisory.severity !== 'high' && advisory.severity !== 'critical') continue;
  const allowance = allowedHigh.get(advisory.id);
  if (!allowance) {
    blockers.push(`${advisory.id} ${advisory.package} ${advisory.severity}: ${advisory.title}`);
    continue;
  }
  if (allowance.package !== advisory.package || allowance.severity !== advisory.severity) {
    blockers.push(
      `${advisory.id} changed contract: expected ${allowance.package}/${allowance.severity}, ` +
        `got ${advisory.package}/${advisory.severity}`,
    );
    continue;
  }
  if (today > allowance.reviewBy) {
    blockers.push(`${advisory.id} exception review expired on ${allowance.reviewBy}`);
    continue;
  }
  accepted.push({ ...advisory, ...allowance });
}

const metadata = report.metadata?.vulnerabilities ?? {};
if (Number(metadata.critical ?? 0) > 0 && !advisories.some((entry) => entry.severity === 'critical')) {
  blockers.push('npm reports critical vulnerabilities but no direct critical advisory could be parsed');
}
if (Number(metadata.high ?? 0) > 0 && !advisories.some((entry) => entry.severity === 'high')) {
  blockers.push('npm reports high vulnerabilities but no direct high advisory could be parsed');
}

console.log(
  `npm audit metadata: total=${metadata.total ?? 'n/a'} critical=${metadata.critical ?? 'n/a'} ` +
    `high=${metadata.high ?? 'n/a'} moderate=${metadata.moderate ?? 'n/a'} low=${metadata.low ?? 'n/a'}`,
);
for (const advisory of accepted) {
  console.log(
    `accepted temporary high advisory ${advisory.id} package=${advisory.package} ` +
      `range=${advisory.range} reviewBy=${advisory.reviewBy}: ${advisory.reason}`,
  );
}
for (const advisory of advisories.filter((entry) => entry.severity === 'moderate')) {
  console.log(`visible moderate advisory ${advisory.id} package=${advisory.package}: ${advisory.title}`);
}

if (blockers.length) {
  console.error('unapproved high/critical npm advisories detected:');
  for (const blocker of blockers) console.error(`- ${blocker}`);
  process.exit(1);
}

console.log('npm high/critical advisory baseline accepted');
