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
  ['RESTORE_DB: renova_restore', 'restore drill must restore into a distinct named database'],
  ['bash scripts/database-restore-drill.sh', 'workflow must execute the canonical native restore script'],
  ['scripts/verify_current_migration_schema.py', 'restore drill must verify the reflected schema at the current bundled Alembic head'],
  ['scripts/verify_orm_schema_parity.py', 'restore drill must verify complete ORM/Alembic column parity'],
  ['scripts/restore_drill_fixture.py seed', 'restore drill must create deterministic source data'],
  ['scripts/restore_drill_fixture.py verify', 'restore drill must verify restored data fingerprint'],
  ['rm -f "$DR_DIR/renova.dump"', 'restore drill must delete the synthetic dump after verification'],
  ['restore-verification.json', 'restore drill must retain a sanitized verification record'],
]) {
  contains(workflow, token, message);
}

excludes(workflow, 'schema-catchup-candidate', 'temporary schema catch-up job must not remain in the permanent DR workflow');
excludes(workflow, 'path: ${{ runner.temp }}/renova-dr/renova.dump', 'database dump must never be uploaded as a CI artifact');
excludes(workflow, 'path: ${{ runner.temp }}/renova-dr\n', 'whole DR working directory must not be uploaded');
excludes(workflow, ':latest', 'restore drill must not use mutable latest database images');

const native = src('scripts/database-restore-drill.sh');
for (const [token, message] of [
  ['SOURCE_DB', 'native restore must name the source database explicitly'],
  ['RESTORE_DB', 'native restore must name the restore target explicitly'],
  ['[[ "$SOURCE_DB" != "$RESTORE_DB" ]]', 'native restore must reject restoring into the source database'],
  ['pg_dump', 'native restore must execute PostgreSQL pg_dump'],
  ['--format=custom', 'native restore must use PostgreSQL custom dump format'],
  ['--no-owner --no-privileges', 'native dump/restore must avoid replaying environment-specific ownership'],
  ['pg_restore --list', 'native restore must inspect the dump before restoring'],
  ['createdb', 'native restore must create a fresh isolated target'],
  ['pg_restore', 'native restore must execute PostgreSQL pg_restore'],
  ['--exit-on-error', 'native restore must fail closed on pg_restore errors'],
  ['SELECT current_database()', 'native restore must prove it is checking the isolated target'],
]) {
  contains(native, token, message);
}
excludes(native, 'DROP DATABASE', 'CI restore drill must not need destructive database deletion');
excludes(native, 'pg_dumpall', 'DR proof must not export global roles or cluster credentials');

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
contains(doc, 'ORM/Alembic', 'DR docs must state that restored mapped schema parity is verified');

console.log('databaseRestoreTruth.test OK');
