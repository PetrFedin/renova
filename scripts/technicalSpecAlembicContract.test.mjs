#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const versionsDir = path.join(root, 'backend', 'alembic', 'versions');
const masterSpec = fs.readFileSync(path.join(root, 'docs', 'RENOVA-TECHNICAL-SPECIFICATION.md'), 'utf8');
const materialSupplyAnnexPath = path.join(root, 'docs', 'technical-spec', 'MATERIAL-SUPPLY-CONTRACT.md');
const materialSupplyAnnex = fs.existsSync(materialSupplyAnnexPath)
  ? fs.readFileSync(materialSupplyAnnexPath, 'utf8')
  : '';

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
const documentedInMaster = masterSpec.includes(`\`${head}\``);
const documentedInGovernedAnnex = materialSupplyAnnex.includes(`\`${head}\``);
assert.ok(
  documentedInMaster || documentedInGovernedAnnex,
  `technical specification is stale: current Alembic head ${head} is not documented in master or governed schema annex`,
);
if (!documentedInMaster) {
  assert.ok(
    masterSpec.includes('**Текущий verification status:** `PENDING REVERIFY`'),
    'schema-head annex may temporarily supersede the master header only while the master is PENDING REVERIFY',
  );
  assert.ok(
    materialSupplyAnnex.includes('**Schema head:**'),
    'governed schema annex must declare an explicit Schema head field',
  );
}

console.log(
  `Renova technical specification Alembic contract: OK (head ${head}, ${revisions.size} revisions, ${documentedInMaster ? 'master' : 'governed annex'})`,
);
