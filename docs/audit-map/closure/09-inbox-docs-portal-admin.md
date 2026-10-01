# Закрытие аудита: входящие, документы, портал, админ-экраны (INB-01..37, CMP-016..030)

Источник: `docs/audit-map/09-screen-census-routes.md` (INB-*) и `10-components-forms-states-offline.md` (CMP-016..030).
Каждая запись проверена по коду текущего main; воспроизводящиеся P1/P2 исправлены в этой волне.
Проверка вживую (Expo web, вкладка с демо-сессией исполнителя): «Согласования», «Документы», «Архив ремонта», портал с неверным токеном.

Итог: проверено 37 + 15 = 52 записи. Исправлено сейчас 23, уже исправлено ранее 20, не исправлено 9 (причины в таблицах).

## INB-*

| ID | Статус | Доказательство |
|---|---|---|
| INB-01 | уже исправлено ранее | 0ca98c7b: ссылки исполнителя только на чтение; `DocumentsHub.tsx` `portalShare` шлёт `allow_accept_stage:false, allow_pay:false` |
| INB-02 | уже исправлено ранее | 0ca98c7b: портальный JWT ограничен ссылкой; клиент держит его отдельно (`registerPortalBearer`, `lib/api/client.ts`) |
| INB-03 | уже исправлено ранее | eb182812: договор фиксируется при подписании, портал активируется только при подписях обеих сторон; `signature_party` в `project_document_service.py` |
| INB-04 | не исправлено — нужна серверная модель | токен по-прежнему stateless HMAC без отзыва (`portal_token_service.py`); без миграции список/отзыв ссылок не сделать. Клиент теперь показывает понятный текст для просроченной/недействительной ссылки (см. INB-18) |
| INB-05 | исправлено сейчас | `app/approvals.tsx`: решает тот, кому сервер дал `allowed_actions` (исполнитель — заявки на комнаты); `lib/domain/buildInboxItems.ts` — строка во «Входящих» исполнителя; тип `ApprovalItem.allowed_actions` |
| INB-06 | исправлено сейчас | `app/approvals.tsx` `handleDecisionError`: `notifyError` с причиной, после 404/409 список перечитывается |
| INB-07 | исправлено сейчас | `lib/fieldDiff.ts` `mergeFieldChoices` (+ `lib/fieldDiff.test.ts`): без серверной версии «Сервер» не стирает поле; `FieldMergePicker` скрыт без `server`, `OfflineDiffViewer` объясняет, что делать |
| INB-08 | исправлено сейчас | `ManagerDashboardScreen.tsx`: в загрузке и ошибке есть `BackHeader`, ошибка — `LoadErrorState` с «Повторить» |
| INB-09 | уже исправлено ранее | 02fccb43: полная статья при правке, try/catch, `confirmAction` на «✕» (`articles-admin.tsx`) |
| INB-10 | исправлено сейчас | `DocumentsHub.tsx`: при `readOnly` скрыты «+ Файл», подпись, OCR, защита, архив, дайджест, портал, гарантия, закрытие, импорт выписки, «Создать договор» |
| INB-11 | исправлено сейчас | дайджест — `confirmAction` в `DocumentsHub.tsx` и `app/_stack/reports.tsx`; гарантия уже открывает форму (`WarrantyTextModal`), а не создаёт обращение одним тапом |
| INB-12 | исправлено сейчас | «В архив» — `confirmAction` (destructive) с пометкой для подписанных; сервер уже защищает основной договор (`archive_document`: `main_contract_protected`) |
| INB-13 | исправлено сейчас | «Подписать в приложении» — подтверждение с названием, версией и текстом о простой подписи |
| INB-14 | исправлено сейчас | `buildInboxItems.ts`: исполнитель получает строку «Подписать документ»; обе стороны подписывают (backend `signature_party`) |
| INB-15 | исправлено сейчас | `app/activity.tsx`: состояние ошибки + `LoadErrorState` «Повторить» |
| INB-16 | исправлено сейчас | `ActivityFeed.tsx`: загрузка, `EmptyActionState` (в т.ч. «Сбросить фильтр»), убран дублирующий набор чипов; в `GlobalFilterBar` добавлен «Комнаты» |
| INB-17 | уже исправлено ранее | `lib/pushLinks.ts` `linkForRole`: для исполнителя `/(customer)/…` → `/(contractor)/…` (проверено запуском `resolvePushLink`) |
| INB-18 | исправлено сейчас | `lib/domain/portalErrors.ts` (+ тест) и `PortalScreen.tsx`; вживую: «Ссылка недействительна или срок её действия истёк. Попросите прислать новую ссылку.» |
| INB-19 | исправлено сейчас | `PortalScreen.tsx`: шторка «Причина» (обязательна) для возврата этапа, отклонения сметы и графика |
| INB-20 | не исправлено — гипотеза, P2 | сценарий (устаревший кэш снимка после сбоя сети) не воспроизведён; нужен `provenance` для GET портала — отдельная задача |
| INB-21 | уже исправлено ранее | `registerPortalBearer` (4e56e9ab): токен портала не подменяет сессию приложения |
| INB-22 | исправлено сейчас | `app/_stack/scratchpad.tsx`: роль из `useRenova().user.role`, `?role=` — запасной вариант |
| INB-23 | уже исправлено ранее | `useAdminAccess` + `AdminHubLink`/профиль показывают админ-пункты только после подтверждённого доступа |
| INB-24 | исправлено сейчас | `outbox-dead-letters.tsx`: список и сводка грузятся независимо (`Promise.allSettled`), при ошибке нет «Проблемных событий нет»; статус «Состояние неизвестно» |
| INB-25 | уже исправлено ранее | 02fccb43: снятые статьи скрыты |
| INB-26 | уже исправлено ранее | 02fccb43: `GuideScreen`/`article/[slug]` — загрузка, ошибка, пусто |
| INB-27 | уже исправлено ранее | e2fa4a2b (MKT-021): ссылку создаёт явная кнопка, `try/catch` вокруг `joinTeam`; сейчас убран жаргон («H1.5», «staging», «invite») |
| INB-28 | исправлено сейчас | `subscription.tsx`: ошибка загрузки — `LoadErrorState`, не «Бесплатно»; убраны `YOOKASSA_*`, «Staging/production» |
| INB-29 | не исправлено — нужно разделить эндпоинты | health ЮKassa/ФНС вызывают и обычные клиентские экраны (`IntegrationHonestyBadge`, `ReceiptList`); закрыть для не-админов можно только после выделения админского варианта |
| INB-30 | исправлено сейчас | `approvals.tsx`: «Загрузка согласований…» вместо «Нет ожидающих» |
| INB-31 | не исправлено — P3 | мёртвый backend-код вне зоны безопасных правок |
| INB-32 | исправлено сейчас | `AdminHubLink.tsx` и «Журнал аудита» в профиле — без ограничения «только web» |
| INB-33 | исправлено сейчас | `DocumentsHub.tsx`: «Распознавание: на устройстве», «Контур.Подпись: …», «Подпись: только в приложении», русские тексты закрытия объекта, убрано «W67» |
| INB-34 | не исправлено — P3 | `openPaymentSheet` в `PortalScreen.tsx` по-прежнему собирает упрощённый этап; нужен этап в снимке портала |
| INB-35 | исправлено сейчас (частично) | `checklist-templates.tsx`: ошибка загрузки отличается от «нет шаблонов», защита от двойного сохранения, `BackHeader` вне `ScrollView`; редактирование/удаление не добавлены |
| INB-36 | исправлено сейчас | `ReportPdfActions.tsx`: busy/disabled, цель касания 44 |
| INB-37 | исправлено сейчас | `UnifiedInboxScreen.tsx`: результат отправки очереди показывается (`notifyInfo`/`notifyError`) |

## CMP-016..030

| ID | Статус | Доказательство |
|---|---|---|
| CMP-016 | уже исправлено ранее | 4e56e9ab: `clearAllCachedGets` (`lib/api/client.ts`) при выходе |
| CMP-017 | уже исправлено ранее | 4e56e9ab: `registerPortalBearer` |
| CMP-018 | исправлено частично | `lib/notify.ts` (`notifyError`/`describeFailure`) введён ранее; в экранах этой зоны (approvals, subscription, документы, чат-задача, отчёты) причина показывается. Остальные места — в зонах других разделов |
| CMP-019 | исправлено частично | `ChatTaskSheet` переведён на `SheetSurface`; `chat/CreateChatSheet` и `os/OsQuickFab` остаются на `Modal` (гипотеза, на устройстве не проверялось) |
| CMP-020 | уже исправлено ранее | `RejectStageModal.tsx`: причина обязательна, `busy`, шторка не закрывается до ответа |
| CMP-021 | уже исправлено ранее | a442ce94: `offlineJobLabel.ts` — точные шаблоны пути |
| CMP-022 | не исправлено — намеренно | удаление мёртвых компонентов требует доказательства отсутствия зависимостей; не трогал |
| CMP-023 | исправлено частично | accessibilityRole/Label и цели 44 px: `ChatListView`, `ChatProjectFilter`, `ChatTaskSheet`, `OfflineSyncStatus`, `ActivityFeed`/`GlobalFilterBar`, `FieldMergePicker`, `ManagerDashboardScreen`, `approvals`, `team-qr`, `articles-admin`, `ReportPdfActions`, `DocumentsHub` («+ Файл»); токены вместо hex в `OfflineDiffViewer`, `FieldMergePicker`, `ActivityFeed`. Остальное — вне зоны |
| CMP-024 | уже исправлено ранее | `subscribeToInFlight` (`lib/api/client.ts`): отмена одного вызывателя не роняет остальных |
| CMP-025 | уже исправлено ранее | `lib/domain/fallbackDashboard.ts:21` `days_overdue: null` |
| CMP-026 | уже исправлено ранее | `lib/api/payments.ts`, `documents.ts`: отдельные тексты `WRITE_RESPONSE_UNKNOWN`/`UPLOAD_RESPONSE_UNKNOWN` |
| CMP-027 | уже исправлено ранее | `StageDetailScreen.tsx`: нет сети при `getUploadUrl` → очередь/понятное сообщение |
| CMP-028 | не исправлено — гипотеза | лимит строки AsyncStorage не проверялся |
| CMP-029 | уже исправлено ранее | `checkDateRange` в `CreateStageSheet`/`CreateWorkSheet`; пикер даты не добавлялся |
| CMP-030 | уже исправлено ранее | жаргон «gate»/«pending-оплаты»/«матч» в интерфейсе больше не встречается (grep) |

## Тесты

- Новые: `lib/domain/portalErrors.test.ts`, `lib/fieldDiff.test.ts` — подключены в `mobile:test`.
- `npm run typecheck:mobile`: real=0.
- Контракты (`clarityWaveQ.w170`, `sheetChromeContract`, `notifyGuard`) зелёные для файлов этой зоны.
