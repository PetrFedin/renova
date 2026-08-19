# Renova database disaster recovery readiness

Renova must not treat a backup as a recovery strategy until a restore has been executed and verified. This document separates what the repository can prove from what requires a real managed PostgreSQL provider.

## Current evidence

The repository is intended to prove the **logical dump/restore procedure** with a synthetic PostgreSQL 17 database:

1. apply the current Alembic head to a fresh PostgreSQL source database;
2. validate the reflected migration schema;
3. create deterministic synthetic Renova domain rows;
4. create a native PostgreSQL custom-format dump with `pg_dump`;
5. restore that dump into a separate fresh database with `pg_restore --exit-on-error`;
6. re-run the reflected schema verifier against the restored database;
7. compare a deterministic SHA-256 data fingerprint between source and restored fixtures;
8. delete the synthetic dump and retain only a sanitized verification record.

This proves that the current schema and a representative set of Renova relational/domain data can survive the repository-defined logical restore path. It does **not** prove that a production provider is creating backups.

## Launch blockers that require a real provider

- Automated provider backups: **NOT PROVEN**
- PITR: **NOT PROVEN**
- Backup encryption at rest: **NOT PROVEN**
- Backup retention policy: **NOT PROVEN**
- Cross-account / isolated backup access: **NOT PROVEN**
- Production restore environment: **NOT PROVEN**
- Last real-provider restore drill: **NOT PROVEN**
- RPO: **UNSET / launch blocker**
- RTO: **UNSET / launch blocker**

RPO and RTO must be selected as business/operations targets and then measured during a provider-backed restore drill. The repository must not invent a target and report it as achieved.

## Provider requirements

Before Renova can be marked production-ready, the selected managed PostgreSQL platform must provide evidence for:

- scheduled automated backups;
- point-in-time recovery with a documented recovery window;
- encryption at rest and encrypted transport;
- retention and deletion policy;
- least-privilege backup/restore access;
- a repeatable isolated restore procedure;
- timestamps sufficient to calculate actual RPO and RTO during a drill.

A provider-backed drill should restore into an isolated environment, never over the live production database. Application verification must use the same migration/schema checks as CI and must avoid exporting restored customer data into CI artifacts or logs.

## Evidence policy

CI may retain only sanitized restore metadata such as:

- PostgreSQL major version;
- Alembic revision;
- synthetic fixture fingerprint;
- dump size for the synthetic fixture;
- pass/fail state.

The `.dump` file itself is synthetic but is still deleted after the drill and is not uploaded as an artifact. Real customer backups must never be copied into repository CI merely to make a green badge.
