#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const versionsDir = path.join(root, 'backend', 'alembic', 'versions');
const spec = fs.readFileSync(path.join(root, 'docs', 'RENOVA-TECHNICAL-SPECIFICATION.md'), 'utf8');

const revisions = new Set();
const referencedParents = new Set();

for (const name of fs.readdirSync(versionsDir).filter((file) => file.endsWith('.py'))) {
  const content = fs.readFileSync(path.join(versionsDir, name), 'utf8');
  const revision = content.match(/^revision(?:\s*:\s*[^=]+)?\s*=\s*["']([^"']+)["']/m)?.[1];
  if (!revision) continue;
  revisions.add(revision);

  const downLine = content.match(/^down_revision(?:\s*:\s*[^=]+)?\s*=\s*(.+)$/m)?.[1] ?? '';
  for (const match of downLine.matchAll(/["']([^"']+)["']/g)) {
    referencedParents.add(match[1]);
  }
}

assert.ok(revisions.size > 0, 'no Alembic revisions discovered');
const heads = [...revisions].filter((revision) => !referencedParents.has(revision));
assert.deepEqual(heads.length, 1, `Alembic graph must have exactly one head, found: ${heads.join(', ')}`);
const [head] = heads;
assert.ok(
  spec.includes(`\`${head}\``),
  `technical specification is stale: current Alembic head ${head} is not documented`,
);

console.log(`Renova technical specification Alembic contract: OK (head ${head}, ${revisions.size} revisions)`);
