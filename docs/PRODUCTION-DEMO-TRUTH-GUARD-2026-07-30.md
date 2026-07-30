# Production demo truth guard — 2026-07-30

## Defect

Environment profiles state that staging and production forbid:

- automatic SQLAlchemy `create_all`;
- demo user/article seed.

However, explicit environment overrides were evaluated before the policy:

- `ALLOW_CREATE_ALL=true` could enable `Base.metadata.create_all()`;
- `ALLOW_DEMO_SEED=true` could insert demo users and articles.

`validate_runtime_settings()` did not receive or validate either flag, so a deployment misconfiguration could bypass the documented production policy.

## Canonical rule

An override may only reduce capability:

- `None` → use environment policy;
- `false` → disable an otherwise allowed local capability;
- `true` → enable only when the environment policy already allows it.

An override can never enable a capability forbidden by staging or production.

## Defence in depth

1. Startup validation fails before traffic when staging/production receives a forbidden `true` override.
2. Runtime helpers also resolve flags with `policy_allows AND override`.
3. Database initialization and demo seeding use the same resolver.
4. Staging/production continue to require Alembic and real data only.

## Regression coverage

`backend/tests/test_production_demo_truth_guard.py` verifies:

- production rejects demo seed override;
- production rejects create_all override;
- staging reports both violations together;
- explicit false remains valid;
- development can enable or disable local helpers;
- the resolver can disable but never enable a forbidden capability;
- startup and database runtime paths use the fail-closed resolver.

The test is part of the mandatory backend/E2E CI gate.
