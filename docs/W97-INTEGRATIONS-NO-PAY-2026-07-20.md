# W97 — интеграции без live-оплат (2026-07-20)

Связи **бригада / каталог исполнителей / мебель / аудит / дайджест**.

## Архитектура

```
linkContractor → loadProject + syncProjectSideEffects → home/inbox/смета
inviteTeam / createTeam → sync → TeamSection.useProjectDataReload
createFurniture → sync → FurnitureLayer.useProjectDataReload
pushWeeklyDigest → sync → NotificationCenter / inbox
audit mutations elsewhere → AuditScreen.useProjectDataReload
```

| Поверхность | Связь |
|-------------|--------|
| ContractorDirectory | sync после link + reload каталога |
| ContractorProfile TeamSection | reload бригады по bus |
| ContractorProfile реквизиты | reload по bus |
| FurnitureLayer | reload мебели по bus |
| AuditScreen | журнал после действий |
| HomeCompletionLinks | sync после недельного дайджеста |

## Зачем

Подключили исполнителя — главная и сметa сразу знают `contractor_id`.
Пригласили в бригаду — список участников без remount профиля.
Дайджест — уведомления появляются в профиле.

## Тест

```bash
npx tsx apps/mobile/lib/useProjectDataReload.w97.test.ts
```

## Вне скоупа

H0 live secrets / TestFlight / articles-admin.
