#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const versionsDir = path.join(root, 'backend', 'alembic', 'versions');
const masterSpec = fs.readFileSync(path.join(root, 'docs', 'RENOVA-TECHNICAL-SPECIFICATION.md'), 'utf8');
const readiness = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'production-readiness-evidence.json'), 'utf8'));
const readinessMarkdown = fs.readFileSync(path.join(root, 'PRODUCTION-READINESS.md'), 'utf8');
const headerPrefix = '**Текущий schema head в этой редакции:**';

function assertExplicitHeadAgreement(master, markdown, jsonHead, graphHead) {
  // A mention in a historical paragraph or an annex is not the current passport.
  const lines = master.split(/\r?\n/).filter((line) => line.startsWith(headerPrefix));
  assert.equal(lines.length, 1, 'master must contain exactly one explicit current schema-head header');
  const match = lines[0].match(/:\*\*\s*`([^`]+)`\s*$/);
  assert.ok(match, 'master current schema-head header is malformed');
  assert.equal(match[1], graphHead, 'master current schema-head header is stale');
  assert.equal(jsonHead, graphHead, 'machine-readable readiness schema head is stale');
  const rows = [...markdown.matchAll(/^\|\s*Alembic head\s*\|\s*`([^`]+)`\s*\|\s*$/gm)];
  assert.equal(rows.length, 1, 'readiness must declare exactly one Alembic head row');
  assert.equal(rows[0][1], graphHead, 'readiness Markdown schema head is stale');
}

// Negative controls: the old gate accepted a stale header when another document
// mentioned the new head. Keep these executed with the normal specification gate.
const testHeader = `${headerPrefix} \`current\``;
const testRow = '| Alembic head | `current` |';
assertExplicitHeadAgreement(testHeader, testRow, 'current', 'current');
assert.throws(() => assertExplicitHeadAgreement(
  `${headerPrefix} \`old\`\nHistory/annex mentions \`current\``, testRow, 'current', 'current',
));
assert.throws(() => assertExplicitHeadAgreement('Body mentions `current`', testRow, 'current', 'current'));
assert.throws(() => assertExplicitHeadAgreement(`${testHeader}\n${testHeader}`, testRow, 'current', 'current'));
assert.throws(() => assertExplicitHeadAgreement(testHeader, testRow, 'old', 'current'));
assert.throws(() => assertExplicitHeadAgreement(testHeader, '| Alembic head | `old` |', 'current', 'current'));

const revisions = new Set();
const referencedParents = new Set();
for (const name of fs.readdirSync(versionsDir).filter((file) => file.endsWith('.py'))) {
  const content = fs.readFileSync(path.join(versionsDir, name), 'utf8');
  const revision = content.match(/^revision(?:\s*:\s*[^=]+)?\s*=\s*["']([^"']+)["']/m)?.[1];
  if (!revision) continue;
  assert.ok(!revisions.has(revision), `duplicate Alembic revision ${revision}`);
  revisions.add(revision);
  const downLine = content.match(/^down_revision(?:\s*:\s*[^=]+)?\s*=\s*(.+)$/m)?.[1] ?? '';
  for (const match of downLine.matchAll(/["']([^"']+)["']/g)) referencedParents.add(match[1]);
}
assert.ok(revisions.size > 0, 'no Alembic revisions discovered');
for (const parent of referencedParents) assert.ok(revisions.has(parent), `missing migration parent ${parent}`);
const heads = [...revisions].filter((revision) => !referencedParents.has(revision));
assert.equal(heads.length, 1, `Alembic graph must have exactly one head, found: ${heads.join(', ')}`);
const [head] = heads;
assertExplicitHeadAgreement(masterSpec, readinessMarkdown, readiness.expected_repo_facts?.alembic_head, head);
console.log(`Renova technical specification Alembic contract: OK (head ${head}, ${revisions.size} revisions, explicit master/readiness headers and negative controls)`);
