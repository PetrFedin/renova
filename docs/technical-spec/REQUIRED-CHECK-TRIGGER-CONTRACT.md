# Renova — required PR check trigger contract

**Статус:** ACTIVE / governed annex  
**Область:** GitHub Actions contexts, обязательные ruleset `main-protection`  
**Связь:** issue #247, security PR #372

## Problem

Обязательный status check не может быть одновременно глобально required в ruleset и условно отсутствовать из-за `pull_request.paths`. В такой конфигурации GitHub не создаёт check-run для PR вне path filter, а branch protection ожидает отсутствующий context и блокирует merge независимо от качества изменения.

На PR #372 это воспроизведено фактически: `typecheck-integrity` и `snapshot` не имели ни одного check-run на exact head, хотя оба context обязательны live ruleset. `source-and-runtime` на том PR появился только потому, что изменённый `package-lock.json` случайно входил в его прежний path filter.

## Contract

Для каждого context, который live/canonical `main-protection` требует от **каждого** pull request:

- workflow должен создавать этот context на каждом `pull_request`;
- `pull_request.paths` / `paths-ignore` не применяются к такому workflow;
- push-side path scoping разрешён, если он не влияет на PR required-check availability;
- job name/context остаётся стабильным относительно ruleset;
- отсутствие applicable product changes не является основанием не создавать globally-required check;
- изменение required-context list и изменение workflow trigger должны проверяться как единый governance contract.

Текущий bounded source-side fix делает unconditional PR triggers для:

- `source-and-runtime`;
- `typecheck-integrity`;
- `snapshot`.

Остальные обязательные contexts либо создаются unconditional `CI` workflow, либо уже имеют unconditional PR trigger (`security-source-contract`, `policy`).

## Source snapshot override

Master specification `docs/RENOVA-TECHNICAL-SPECIFICATION.md` фиксирует source snapshot редакции 2026-09-08. Для bounded governance-изменения ниже этот annex является текущим синхронным расширением source snapshot до следующей консолидации master:

| Source | Blob SHA | Назначение |
|---|---|---|
| `.github/workflows/local-runtime-integrity.yml` | `dacee047ae7c8ff449d099bbbd2ec68b8e28dbc6` | Globally-required `source-and-runtime` is scheduled for every PR |

Наличие старой строки этого source в master не является разрешением использовать старый workflow SHA как текущий. Contract test для этого source обязан читать master вместе с данным annex и требовать фактический current blob SHA.

## Verification

- PR, который не меняет runtime/mobile/readiness paths, всё равно должен получить `source-and-runtime`, `typecheck-integrity`, `snapshot`;
- exact-head checks должны завершиться success/accepted status, а не отсутствовать;
- existing CI/backend/security contracts остаются неизменными;
- никакой required context не переименовывается;
- ruleset/repository settings остаются owner-admin responsibility и отдельно сверяются в #247.

## Non-goals

- не ослаблять и не удалять required checks;
- не создавать shortcut/stub success contexts;
- не менять продуктовый runtime;
- не объявлять broad-production readiness только по факту исправления governance trigger;
- не выполнять agent self-merge.
