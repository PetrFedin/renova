# Renova database disaster recovery readiness

Renova must not treat a backup as a recovery strategy until a restore has been executed and verified. This document separates what the repository can prove from what requires a real managed PostgreSQL provider.

## Recovery objectives

The following are **initial launch targets**, not achieved-SLO claims:

- **RPO target: <= 15 minutes / NOT PROVEN.** Production PostgreSQL must provide PITR/WAL continuity sufficient to recover durable database writes to a point no more than 15 minutes before the declared incident point.
- **RTO target: <= 60 minutes / NOT PROVEN.** From the declared database-recovery start time, an isolated restored database must be available, schema/data checks must pass, and the Renova API must reach `/health=status:ok` and `/ready=status:ready` within 60 minutes before traffic cutover is considered.
- **PITR recovery window: >= 7 days target / NOT PROVEN.** The provider must retain continuous recovery history for at least seven rolling days.
- **Automated backup retention: >= 35 days target / NOT PROVEN.** At least one encrypted provider-managed full/base backup or equivalent recoverable backup lineage must be retained daily for at least 35 days.
- **Restore drill cadence: pre-launch + at least quarterly + after material database/provider recovery changes.** CI logical restore evidence runs continuously, but it does not replace the provider-backed drill.

These targets are deliberately explicit so launch readiness can be judged against them. They may be tightened after measured production volume/business criticality is available, but they must not be weakened or marked achieved without an approved operational decision and drill evidence.

## Current repository evidence

The repository proves the **logical dump/restore procedure** with a synthetic PostgreSQL 17 database:

1. apply the current Alembic head to a fresh PostgreSQL source database;
2. validate the reflected migration schema and complete ORM/Alembic mapped table-and-column parity;
3. create deterministic synthetic Renova domain rows;
4. create a native PostgreSQL custom-format dump with `pg_dump`;
5. inspect the dump and restore it into a separate fresh `renova_restore` database with `pg_restore --exit-on-error`;
6. re-run reflected migration and ORM/Alembic parity checks against the restored database;
7. compare a deterministic SHA-256 data fingerprint between source and restored fixtures;
8. boot the actual Renova ASGI lifespan against the restored database with schema creation/demo seed disabled;
9. require both `/health` and `/ready` to pass while `/ready` executes a database query through the restored application's normal `SessionLocal` path;
10. re-run the fixture fingerprint after application startup to prove the smoke path did not change the protected synthetic restore dataset;
11. record sanitized native logical backup+restore duration as an engineering baseline;
12. delete the synthetic dump and retain only a sanitized verification record.

The retained CI timing is explicitly scoped as `synthetic_ci_logical_restore`. It is useful for regression detection but is **not provider RTO evidence**: it excludes production backup age, provider provisioning, network/security changes, PITR selection, DNS/traffic cutover, external dependencies and human incident response.

The restore work previously exposed a production schema gap that the revision-only guard could not detect: the ORM contained mapped tables and columns absent from Alembic history. The additive `w13ormparity01` catch-up revision materializes the missing mapped schema on a clean PostgreSQL database, and the permanent PostgreSQL schema lifecycle gate checks complete ORM/Alembic column parity after both upgrade and migration replay. This is a schema-integrity correction, not product feature expansion.

This repository evidence proves that the current migrated schema, representative Renova relational/domain data, and application health/readiness can survive the repository-defined logical restore path. It does **not** prove that a production provider is creating backups, that provider snapshots/PITR are restorable, or that the RPO/RTO targets are achieved.

## Launch blockers that require a real provider

- Automated provider backups: **NOT PROVEN**
- PITR: **NOT PROVEN**
- Backup encryption at rest: **NOT PROVEN**
- Backup transport encryption: **NOT PROVEN**
- >= 35 day automated backup retention: **NOT PROVEN**
- >= 7 day PITR recovery window: **NOT PROVEN**
- Administratively isolated backup/restore access: **NOT PROVEN**
- Production-like isolated restore environment: **NOT PROVEN**
- Last real-provider restore drill: **NOT PROVEN**
- RPO <= 15 minutes: **TARGET SET / NOT PROVEN**
- RTO <= 60 minutes: **TARGET SET / NOT PROVEN**

## Provider requirements

Before Renova can be marked production-ready, the selected managed PostgreSQL platform must provide evidence for:

- scheduled automated encrypted backups with a recoverable daily lineage retained for at least 35 days;
- point-in-time recovery with a rolling recovery window of at least seven days;
- documented WAL/PITR granularity and timestamps sufficient to verify the <=15 minute RPO target;
- encryption at rest and encrypted backup/restore transport;
- documented retention/deletion behavior, including what happens after database/project deletion;
- least-privilege backup/restore access separated from normal application credentials;
- administratively isolated restore access or an equivalent control preventing one compromised application credential from deleting both primary data and recovery copies;
- a repeatable restore into a separate non-production database/environment, never over the live production database;
- timestamps for incident/drill start, selected recovery point, restore availability, migration/schema verification, application `/ready`, and recovery completion so actual RPO/RTO can be calculated.

## Provider-backed drill acceptance

A provider-backed drill passes only when all of the following are retained in a sanitized evidence packet:

1. immutable identity of the source deployment/database and provider backup/PITR source without secrets;
2. requested recovery point and provider-confirmed recovered point;
3. calculated data-loss interval proving whether actual RPO is <=15 minutes;
4. isolated restore target identity and restore start/available timestamps;
5. current Alembic-head verification and complete ORM/Alembic schema parity on the restored target;
6. application health/readiness against the restored target using the same artifact intended for promotion/recovery;
7. RTO calculation from declared recovery start through verified application readiness, with <=60 minutes required for launch-target PASS;
8. operator/owner, outcome, exceptions, and any follow-up corrective actions.

A provider dashboard saying “backup succeeded” is not restore evidence. A successful `pg_restore` without application readiness is also not enough.

## Evidence and data-handling policy

CI may retain only sanitized restore metadata such as:

- PostgreSQL major version;
- Alembic revision;
- synthetic fixture fingerprint;
- dump size for the synthetic fixture;
- application health/readiness result;
- synthetic logical restore duration and its explicit scope;
- pass/fail state.

The `.dump` file itself is synthetic but is still deleted after the drill and is not uploaded as an artifact. Real customer backups must never be copied into repository CI merely to make a green badge. Provider-backed evidence must not include database credentials, customer row contents, raw backup files or secret restore URLs.
