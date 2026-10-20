/** Customer-only advisory evidence review: never equate a known payment with consent. */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { CustomerConsentCoverage, CustomerConsentCoverageEntry } from '@/lib/api/os';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { reportError } from '@/lib/reportError';

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
  financial_source_cross_project_or_missing: 'Нарушена связь с финансовым источником: запись отсутствует или относится к другому объекту',
  customer_consent_and_source_not_attested: 'Нужна проверка основания, чека или банковского подтверждения',
  approved_material_selection_not_purchase_consent: 'Материалы выбраны, но отдельный лимит закупки не доказан',
  purchase_selection_or_price_evidence_missing: 'Не подтверждены согласованный выбор материала или цена',
  purchase_items_scan_incomplete: 'Перечень закупок слишком велик для полной проверки',
  scope_version_and_customer_consent_snapshot_missing: 'Нет полной неизменяемой версии объёма, сроков и ответственного',
  change_order_lacks_quantity_specialist_and_scope_digest: 'Нужны объём, специалист, сроки и точная версия согласованных допработ',
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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.customerConsentCoverage(userId, projectId);
      setReport(result);
      setFailed(false);
    } catch (error: unknown) {
      // Never render a previous project's snapshot as current after an API error.
      setReport(null);
      setFailed(true);
      reportError('components.renova.CustomerConsentCoveragePanel', error);
    } finally {
      setLoading(false);
    }
  }, [userId, projectId]);

  useEffect(() => {
    setReport(null);
    setExpanded(false);
    void reload();
  }, [reload]);
  useProjectDataReload(reload);

  const issueCount = report?.items_requiring_evidence ?? 0;
  const severeCount = report?.items.filter((row) => row.risk === 'critical' || row.risk === 'high').length ?? 0;
  const visible = report?.items.slice(0, expanded ? 25 : 5) ?? [];

  return (
    <View style={s.card} accessibilityLabel="Проверка подтверждений заказчика">
      <View style={s.header}>
        <View style={s.headerText}>
          <Text style={s.kicker}>ФИНАНСОВЫЙ КОНТРОЛЬ</Text>
          <Text style={s.title}>Доказательства согласований</Text>
        </View>
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
        Проверка выявляет пробелы в связях платежей, закупок, расходов и работ.
        Сама по себе оплата, приёмка или статус «согласовано» не доказывают,
        что заказчик утвердил конкретную сумму и объём работ.
      </Text>
      {loading && !report ? (
        <Text style={s.status}>Проверяем документы и финансовые связи…</Text>
      ) : failed || !report ? (
        <View style={s.warningBox}>
          <Text style={s.warningText}>
            Проверка недоступна. Это не означает, что все расходы согласованы.
            Обновите данные перед финансовым решением.
          </Text>
        </View>
      ) : (
        <>
          <View style={s.metrics}>
            <View style={s.metric}>
              <Text style={s.value}>{report.total_scanned}</Text>
              <Text style={s.metricLabel}>Записей изучено</Text>
            </View>
            <View style={s.metric}>
              <Text style={s.value}>{issueCount}</Text>
              <Text style={s.metricLabel}>Требуют доказательств</Text>
            </View>
            <View style={s.metric}>
              <Text style={[s.value, severeCount > 0 ? s.dangerText : null]}>
                {severeCount}
              </Text>
              <Text style={s.metricLabel}>Высокий риск в выборке</Text>
            </View>
          </View>
          <View style={s.warningBox}>
            <Text style={s.warningText}>
              Полное индивидуальное согласие на каждую операцию пока не подтверждено.
              Это диагностический отчёт, а не разрешение на оплату.
            </Text>
          </View>
          {report.source_integrity_issues > 0 ? (
            <Text style={s.dangerText}>
              Нарушений связей финансовых источников: {report.source_integrity_issues}.
              Необходимо проверить до утверждения расчётов.
            </Text>
          ) : null}
          {visible.map((item) => (
            <View key={item.kind + ':' + item.id} style={s.row}>
              <View style={s.rowHeading}>
                <Text style={s.rowKind}>{KINDS[item.kind]}</Text>
                <Text style={[s.rowRisk, item.risk === 'critical' ? s.dangerText : null]}>
                  {item.evidence_level === 'broken' ? 'Проверить связь' : 'Нет полного согласия'}
                </Text>
              </View>
              <Text style={s.rowTitle} numberOfLines={2}>{item.title}</Text>
              {item.amount_rub !== null ? (
                <Text style={s.rowAmount}>{item.amount_rub === 'invalid' ? 'Некорректная сумма' : item.amount_rub + ' ₽'}</Text>
              ) : null}
              <Text style={s.rowReason}>{REASONS[item.reason_code] || 'Нужна дополнительная проверка документов и согласия'}</Text>
              {item.kind === 'work_order' && Array.isArray(item.references.missing_details)
                && item.references.missing_details.length > 0 ? (
                <Text style={s.rowReason}>
                  Нет данных: {item.references.missing_details.map(String).join(', ')}
                </Text>
              ) : null}
            </View>
          ))}
          {report.items.length > 5 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded((value) => !value)}
              style={s.showMore}
            >
              <Text style={s.refreshText}>{expanded ? 'Свернуть список' : 'Показать больше записей'}</Text>
            </Pressable>
          ) : null}
          {report.items.length === 0 ? (
            <Text style={s.status}>По текущему объекту финансовые записи не найдены. Это не является подтверждением договорных условий.</Text>
          ) : null}
          {report.scan_truncated || report.items_limited ? (
            <Text style={s.truncated}>
              Проверка неполная: превышен лимит сканирования или отображения.
              Нужна постраничная сверка полного реестра.
            </Text>
          ) : null}
          <Text style={s.disclaimer}>
            Вывод основан на доступных связях базы данных, без проверки юридической
            действительности подписей. Данные могут измениться после формирования отчёта.
          </Text>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: ALERT_COLORS.surface,
    borderColor: ALERT_COLORS.border,
    borderWidth: 1,
    borderRadius: RenovaTheme.radius.lg,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  headerText: { flex: 1, gap: 4 },
  kicker: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.tiny, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: ALERT_COLORS.text, fontSize: RenovaTheme.fontSize.h3, fontWeight: '700' },
  refresh: { minHeight: RenovaTheme.minTouch, minWidth: 68, alignItems: 'center', justifyContent: 'center' },
  refreshText: { color: ALERT_COLORS.accent, fontSize: RenovaTheme.fontSize.bodySmall, fontWeight: '600' },
  explainer: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.bodySmall, lineHeight: 19 },
  status: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.bodySmall },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { flex: 1, minWidth: 82, backgroundColor: ALERT_COLORS.surfaceMuted, padding: 10, borderRadius: RenovaTheme.radius.md },
  value: { color: ALERT_COLORS.text, fontSize: RenovaTheme.fontSize.h2, fontWeight: '700' },
  metricLabel: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.tiny, marginTop: 4 },
  warningBox: { padding: 12, backgroundColor: ALERT_COLORS.warningBg, borderRadius: RenovaTheme.radius.md },
  warningText: { color: ALERT_COLORS.warningText, fontSize: RenovaTheme.fontSize.bodySmall, lineHeight: 19 },
  dangerText: { color: ALERT_COLORS.danger, fontSize: RenovaTheme.fontSize.bodySmall },
  row: { borderTopWidth: 1, borderTopColor: ALERT_COLORS.borderLight, paddingTop: 12, gap: 4 },
  rowHeading: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  rowKind: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.caption },
  rowRisk: { color: ALERT_COLORS.warning, fontSize: RenovaTheme.fontSize.caption, fontWeight: '600' },
  rowTitle: { color: ALERT_COLORS.text, fontSize: RenovaTheme.fontSize.body, fontWeight: '600' },
  rowAmount: { color: ALERT_COLORS.text, fontSize: RenovaTheme.fontSize.body, fontWeight: '600' },
  rowReason: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.caption, lineHeight: 18 },
  showMore: { minHeight: RenovaTheme.minTouch, justifyContent: 'center', alignItems: 'center' },
  truncated: { color: ALERT_COLORS.danger, fontSize: RenovaTheme.fontSize.caption },
  disclaimer: { color: ALERT_COLORS.textMuted, fontSize: RenovaTheme.fontSize.tiny, lineHeight: 17 },
});
