/** Customer-only advisory evidence review: never equate a known payment with consent. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RenovaTheme } from '@/constants/Theme';
import { Card, InfoBanner, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import type { CustomerConsentCoverage, CustomerConsentCoverageEntry } from '@/lib/api/os';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { reportError } from '@/lib/reportError';
import { pushOsNav } from '@/lib/pushOsNav';

const KINDS: Record<CustomerConsentCoverageEntry['kind'], string> = {
  payment: 'Оплата',
  expense: 'Расход',
  purchase: 'Закупка',
  work_order: 'Работа',
  change_order: 'Дополнительные работы',
};

const REASONS: Record<string, string> = {
  no_version_bound_payment_consent: 'Нет сквозного подтверждения лимита и условий счёта',
  stage_accepted_not_prior_payment_consent: 'Приёмка этапа не доказывает предварительное согласование счёта',
  approved_change_without_itemized_consent: 'Допработа одобрена, детализация специалиста и объёма не удостоверена',
  change_order_outside_project: 'Счёт связан с допработой вне объекта или запись отсутствует',
  stage_outside_project: 'Счёт связан с этапом вне объекта или запись отсутствует',
  source_link_not_customer_consent: 'Есть финансовый источник, но его согласование заказчиком не доказано',
  expense_currency_requires_reconciliation: 'Сумма указана не в рублях: требуется проверка курса, основания и учётной классификации',
  financial_amount_invalid: 'Сумма расхода некорректна и не может участвовать в рублёвой сверке',
  financial_source_cross_project_or_missing: 'Нарушена связь с финансовым источником: запись отсутствует или относится к другому объекту',
  customer_consent_and_source_not_attested: 'Нужна проверка основания, чека или банковского подтверждения',
  approved_material_selection_not_purchase_consent: 'Материалы выбраны, но отдельный лимит закупки не доказан',
  purchase_selection_or_price_evidence_missing: 'Не подтверждены согласованный выбор материала или цена',
  purchase_items_scan_incomplete: 'Перечень закупок слишком велик для полной проверки',
  scope_version_and_customer_consent_snapshot_missing: 'Нет полной неизменяемой версии объёма, сроков и ответственного',
  change_order_lacks_quantity_specialist_and_scope_digest: 'Нужны объём, специалист, сроки и точная версия согласованных допработ',
  scope_approved_payments_not_allocated: 'Условия работы согласованы заказчиком, но ни один платёж ещё не связан с этим разрешённым лимитом.',
  scope_requires_customer_decision: 'Есть детальное предложение, но требуется отдельное решение заказчика по его точной версии.',
  scope_snapshot_integrity_failed: 'Версия согласованных условий не совпадает с данными работы или контрольной суммой. Нужна проверка истории.',
  scope_authorization_incomplete: 'Согласие заказчика и разрешённый лимит связаны некорректно. Финансовое разрешение не подтверждено.',
  scope_history_scan_incomplete: 'Недостаточно данных, чтобы установить последнюю версию условий работ.',
};

const MISSING_WORK_DETAILS: Record<string, string> = {
  named_specialist: 'имя ответственного специалиста',
  dates: 'срок начала и окончания',
  scope_location: 'комната или этап',
  priced_scope: 'согласованная стоимость',
  structured_quantity_unit: 'количество и единица измерения',
  explicit_inclusions_exclusions: 'что включено и что исключено из цены',
  payment_milestone: 'основание, размер и срок платежа',
};

const ALERT_COLORS = RenovaTheme.colors;

export function CustomerConsentCoveragePanel({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
}) {
  const [report, setReport] = useState<CustomerConsentCoverage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(10);
  const [reportIdentity, setReportIdentity] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setReport(null);
    setReportIdentity(null);
    setLoading(true);
    try {
      const result = await api.customerConsentCoverage(userId, projectId);
      if (generation !== requestGeneration.current) return;
      if (result.project_id !== projectId) throw new Error('consent_coverage_project_mismatch');
      setReport(result);
      setReportIdentity(userId + ':' + projectId);
      setFailed(false);
    } catch (error: unknown) {
      if (generation !== requestGeneration.current) return;
      // A failed read cannot silently retain a previous project's financial facts.
      setReport(null);
      setFailed(true);
      reportError('components.renova.CustomerConsentCoveragePanel', error);
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [userId, projectId]);

  useEffect(() => {
    requestGeneration.current += 1;
    setReport(null);
    setExpanded(false);
    setVisibleLimit(10);
    void reload();
    return () => { requestGeneration.current += 1; };
  }, [reload]);
  useProjectDataReload(reload);

  // Project changes can render before effects execute. Never show old project money.
  const current = report?.project_id === projectId && reportIdentity === userId + ':' + projectId ? report : null;
  const issueCount = current?.items_requiring_evidence ?? 0;
  const visible = expanded ? current?.items.slice(0, visibleLimit) ?? [] : [];

  return (
    <Card variant="base" style={s.layout}>
      <View style={s.header}>
        <View style={s.headerText}>
          <Text style={s.title}>Согласования и расходы</Text>
          <Text style={s.status}>Проверка документов по объекту</Text>
        </View>
        <StatusPill
          tone={failed || (current?.source_integrity_issues ?? 0) > 0 ? 'danger' : 'warning'}
          label={loading ? 'Проверка' : failed ? 'Нет данных' : 'Нужно подтверждение'}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Обновить проверку согласований"
          onPress={() => { void reload(); }}
          style={s.refresh}
        >
          <Text style={s.refreshText}>Обновить</Text>
        </Pressable>
      </View>
      <Text style={s.explainer}>
        Связи платежей с документами не заменяют согласие заказчика
        на конкретные объём и стоимость работ.
      </Text>
      {loading && !current ? (
        <Text style={s.status}>Проверяем документы и финансовые связи…</Text>
      ) : failed || !current ? (
        <InfoBanner
          tone="warning"
          message="Проверка недоступна. Это не означает, что все расходы согласованы. Обновите данные перед финансовым решением."
        />
      ) : (
        <>
          <Text style={s.explainer}>
            Проверено: {current.total_scanned}. Требуют подтверждения: {issueCount}.
          </Text>
          <Text style={s.disclaimer}>
            Полное индивидуальное согласие на каждую операцию пока не подтверждено.
            Диагностика не является разрешением на оплату.
          </Text>
          {current.budget_comparison === 'provisional_mismatch' ? (
            <InfoBanner
              tone="danger"
              title="Не сходятся финансовые данные"
              message={`Предварительное расхождение: ${current.budget_drift_rub} ₽. Нужна транзакционная сверка.`}
            />
          ) : null}
          {current.budget_comparison === 'unverifiable' ? (
            <Text style={s.truncated}>
              Сверить общий бюджет нельзя: недостаточно данных или превышен лимит проверки.
            </Text>
          ) : null}
          {current.source_integrity_issues > 0 ? (
            <Text style={s.dangerText}>
              Нарушений связей финансовых источников: {current.source_integrity_issues}.
              Необходимо проверить до утверждения расчётов.
            </Text>
          ) : null}
          {visible.map((item) => (
            <View key={item.kind + ':' + item.id} style={s.row}>
              <View style={s.rowHeading}>
                <Text style={s.rowKind}>{KINDS[item.kind]}</Text>
                <StatusPill
                  tone={item.evidence_level === 'broken' ? 'danger' : 'warning'}
                  label={item.evidence_level === 'broken' ? 'Нарушена связь' : 'Уточнить'}
                />
              </View>
              <Text style={s.rowTitle} numberOfLines={2}>{item.title}</Text>
              {item.amount_rub !== null ? (
                <Text style={s.rowAmount}>{item.amount_rub === 'invalid' ? 'Некорректная сумма' : item.amount_rub + ' ₽'}</Text>
              ) : null}
              {item.kind === 'expense' && item.references.original_currency !== 'RUB' ? (
                <Text style={s.rowAmount}>
                  {String(item.references.original_amount ?? '—')}{' '}
                  {String(item.references.original_currency ?? 'валюта неизвестна')} — не пересчитано в ₽
                </Text>
              ) : null}
              <Text style={s.rowReason}>{REASONS[item.reason_code] || 'Нужна дополнительная проверка документов и согласия'}</Text>
              {item.kind === 'work_order' && item.references.scope_version != null ? (
                <Text style={s.rowReason}>
                  Версия условий №{String(item.references.scope_version)}
                  {item.references.scope_approved === true
                    ? ` · лимит работы ${String(item.references.scope_cap_rub)} ₽`
                    : ' · требуется проверка'}
                </Text>
              ) : null}
              {item.kind === 'work_order' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Открыть карточку согласуемой работы"
                  style={s.showMore}
                  onPress={() => pushOsNav(
                    { pathname: '/work-order/[id]', params: { id: item.id } },
                    undefined,
                    'customer',
                  )}
                >
                  <Text style={s.refreshText}>Открыть работу</Text>
                </Pressable>
              ) : null}
              {item.kind === 'work_order' && Array.isArray(item.references.missing_details)
                && item.references.missing_details.length > 0 ? (
                <Text style={s.rowReason}>
                  Нет данных: {item.references.missing_details.map((detail) => MISSING_WORK_DETAILS[String(detail)] || String(detail)).join(', ')}
                </Text>
              ) : null}
            </View>
          ))}
          {current.items.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded((value) => !value)}
              style={s.showMore}
            >
              <Text style={s.refreshText}>{expanded ? 'Скрыть детали' : `Посмотреть операции (${current.items.length})`}</Text>
            </Pressable>
          ) : null}
          {expanded && current.items.length > visibleLimit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Показать следующие финансовые операции"
              onPress={() => setVisibleLimit((limit) => limit + 10)}
              style={s.showMore}
            >
              <Text style={s.refreshText}>Показать ещё ({Math.min(10, current.items.length - visibleLimit)})</Text>
            </Pressable>
          ) : null}
          {current.items.length === 0 ? (
            <Text style={s.status}>По текущему объекту финансовые записи не найдены. Это не является подтверждением договорных условий.</Text>
          ) : null}
          {current.scan_truncated || current.items_limited ? (
            <Text style={s.truncated}>
              Проверка неполная: превышен лимит выборки. Для остальных операций нужна постраничная сверка.
            </Text>
          ) : null}
          <Text style={s.disclaimer}>
            Проверено: {current.as_of_utc ? new Date(current.as_of_utc).toLocaleString('ru-RU') : 'дата неизвестна'}.
          </Text>
          <Text style={s.disclaimer}>
            Вывод основан на доступных связях базы данных, без проверки юридической
            действительности подписей. Данные могут измениться после формирования отчёта.
          </Text>
        </>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  layout: { gap: RenovaTheme.spacing.sm },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  headerText: { flex: 1, gap: 4 },

  title: { color: ALERT_COLORS.text, fontSize: RenovaTheme.fontSize.h3, fontWeight: '700' },
  refresh: { minHeight: RenovaTheme.minTouch, minWidth: 68, alignItems: 'center', justifyContent: 'center' },
  refreshText: { color: ALERT_COLORS.accent, fontSize: RenovaTheme.fontSize.bodySmall, fontWeight: '600' },
  explainer: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.bodySmall, lineHeight: 19 },
  status: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.bodySmall },






  dangerText: { color: ALERT_COLORS.danger, fontSize: RenovaTheme.fontSize.bodySmall },
  row: { borderTopWidth: 1, borderTopColor: ALERT_COLORS.borderLight, paddingTop: 12, gap: 4 },
  rowHeading: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  rowKind: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.caption },

  rowTitle: { color: ALERT_COLORS.text, fontSize: RenovaTheme.fontSize.body, fontWeight: '600' },
  rowAmount: { color: ALERT_COLORS.text, fontSize: RenovaTheme.fontSize.body, fontWeight: '600' },
  rowReason: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.caption, lineHeight: 18 },
  showMore: { minHeight: RenovaTheme.minTouch, justifyContent: 'center', alignItems: 'center' },
  truncated: { color: ALERT_COLORS.danger, fontSize: RenovaTheme.fontSize.caption },
  disclaimer: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.tiny, lineHeight: 17 },
});
