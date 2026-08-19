import { readFileSync } from 'node:fs';

const src = (path) => readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const contains = (text, token, message) => assert(text.includes(token), message);
const excludes = (text, token, message) => assert(!text.includes(token), message);

const workflow = src('.github/workflows/database-restore-integrity.yml');
for (const [token, message] of [
  ['postgres:17-alpine@sha256:', 'restore drill must pin the PostgreSQL 17 image by digest'],
  ['python-version: "3.12.13"', 'restore drill must pin Python'],
  ['"poetry==2.4.1"', 'restore drill must pin Poetry'],
  ['pg_dump', 'restore drill must execute native pg_dump'],
  ['--format=custom', 'restore drill must use PostgreSQL custom dump format'],
  ['pg_restore', 'restore drill must execute native pg_restore'],
  ['--exit-on-error', 'restore must fail closed on pg_restore errors'],
  ['renova_restore', 'restore drill must restore into a distinct database'],
  ['scripts/verify_migration_schema.py --expect present', 'restore drill must verify reflected Alembic schema'],
  ['scripts/restore_drill_fixture.py seed', 'restore drill must create deterministic source data'],
  ['scripts/restore_drill_fixture.py verify', 'restore drill must verify restored data fingerprint'],
  ['rm -f "$dr_dir/renova.dump"', 'restore drill must delete the synthetic dump after verification'],
  ['restore-verification.json', 'restore drill must retain a sanitized verification record'],
]) {
  contains(workflow, token, message);
}

excludes(workflow, 'path: ${{ runner.temp }}/renova-dr/renova.dump', 'database dump must never be uploaded as a CI artifact');
excludes(workflow, 'retention-days: 90\n          path: ${{ runner.temp }}/renova-dr', 'whole DR working directory must not be uploaded');
excludes(workflow, ':latest', 'restore drill must not use mutable latest database images');

const fixture = src('backend/scripts/restore_drill_fixture.py');
contains(fixture, 'Synthetic restore drill address', 'restore fixture must be obviously synthetic');
contains(fixture, 'fingerprint_sha256', 'restore fixture must produce a deterministic fingerprint');
contains(fixture, 'restore drill fixture is incomplete', 'restore verification must fail closed on missing data');
contains(fixture, 'restored fixture does not match source manifest', 'restore verification must fail on data mismatch');
excludes(fixture, 'seed_demo', 'DR fixture must not depend on demo/customer seed data');

const doc = src('docs/DISASTER-RECOVERY.md');
contains(doc, 'Automated provider backups: **NOT PROVEN**', 'DR docs must not overclaim automated backups');
contains(doc, 'PITR: **NOT PROVEN**', 'DR docs must not overclaim PITR');
contains(doc, 'RPO: **UNSET / launch blocker**', 'DR docs must keep RPO explicit until selected');
contains(doc, 'RTO: **UNSET / launch blocker**', 'DR docs must keep RTO explicit until selected');
contains(doc, 'logical dump/restore procedure', 'DR docs must distinguish the repository-proven restore drill');

console.log('databaseRestoreTruth.test OK');
