/** Отчёты Renova OS — просмотр in-app + PDF (открыть / поделиться / скачать).
 * JSON preview sources are independent and must never turn load failure into fake loading/empty truth. */
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View, Text, StyleSheet, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { pushOsNav } from '@/lib/pushOsNav';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { homeTypography } from '@/constants/homeTypography';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { BackHeader } from '@/components/renova/BackHeader';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { HomeLinkRow } from '@/components/renova/os/HomeLinkRow';
import { ReportPdfActions } from '@/components/reports/ReportPdfActions';
import { ReportSectionPicker } from '@/components/reports/ReportSectionPicker';
import { FinalReportView } from '@/components/reports/FinalReportView';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { api } from '@/lib/api';
import { tabsPrefix, type OsRole } from '@/constants/osSections';
import {
  DEFAULT_FINAL_SECTIONS,
  EXPENSE_CATEGORIES,
  type ExpenseCategoryId,
  type FinalReportSectionId,
} from '@/lib/reports/reportSections';
import type { DailyReport, FinalReport, WeeklyReport } from '@/lib/reports/reportTypes';
import { useAsyncResource } from '@/lib/async/useAsyncResource';
import {
  asyncHasData,
  asyncIsLoading,
  asyncShowError,
  asyncShowStale,
} from '@/lib/async/asyncResource';

function toggleId<T extends string>(list: T[], id: T, min = 1): T[] {
  if (list.includes(id)) {
    if (list.length <= min) return list;
    return list.filter((x) => x !== id);
  }
  return [...list, id];
}

export default function ReportsScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const defaultReturnTo = `${tabsPrefix(role)}/profile`;
  const userId = user?.id;
  const projectId = activeProject?.id;
  const dataEnabled = Boolean(userId && projectId);
  const dataContext = `${userId || ''}:${projectId || ''}`;

  const [sections, setSections] = useState<FinalReportSectionId[]>(DEFAULT_FINAL_SECTIONS);
  const [categories, setCategories] = useState<ExpenseCategoryId[]>(EXPENSE_CATEGORIES.map((c) => c.id));

  const {
    resource: dailyResource,
    data: daily,
    reload: reloadDaily,
  } = useAsyncResource<DailyReport>({
    contextKey: `reports-daily:${dataContext}`,
    enabled: dataEnabled,
    autoLoad: false,
    scope: 'app._stack.reports.Daily',
    isEmpty: () => false,
    fetcher: async () => {
      if (!userId || !projectId) throw new Error('reports_context_missing');
      return { data: await api.reportDaily(userId, projectId) as DailyReport };
    },
  });
  const {
    resource: weeklyResource,
    data: weekly,
    reload: reloadWeekly,
  } = useAsyncResource<WeeklyReport>({
    contextKey: `reports-weekly:${dataContext}`,
    enabled: dataEnabled,
    autoLoad: false,
    scope: 'app._stack.reports.Weekly',
    isEmpty: () => false,
    fetcher: async () => {
      if (!userId || !projectId) throw new Error('reports_context_missing');
      return { data: await api.reportWeekly(userId, projectId) as WeeklyReport };
    },
  });
  const {
    resource: finalResource,
    data: finalReport,
    reload: reloadFinal,
  } = useAsyncResource<FinalReport>({
    contextKey: `reports-final:${dataContext}`,
    enabled: dataEnabled,
    autoLoad: false,
    scope: 'app._stack.reports.FinalReport',
    isEmpty: () => false,
    fetcher: async () => {
      if (!userId || !projectId) throw new Error('reports_context_missing');
      return { data: await api.reportFinal(userId, projectId) as FinalReport };
    },
  });

  const reload = useCallback(() => {
    if (!dataEnabled) return;
    void reloadDaily({ soft: true });
    void reloadWeekly({ soft: true });
    void reloadFinal({ soft: true });
  }, [dataEnabled, reloadDaily, reloadWeekly, reloadFinal]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useProjectDataReload(reload);

  const onPdfError = () => Alert.alert('Ошибка', 'Не удалось сформировать PDF. Проверьте сервер.');

  if (!user || !activeProject) {
    return <ProjectEmptyState role={user?.role === 'contractor' ? 'contractor' : 'customer'} title="Нет объекта для отчётов" />;
  }

  const budget = weekly?.budget || {};

  return (
    <>
      <BackHeader title="Отчёты" returnTo={returnTo || defaultReturnTo} subtitle={activeProject.name} />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Сегодня</Text>
          {asyncShowStale(dailyResource) ? (
            <>
              <InfoBanner
                tone="warning"
                title="Дневной отчёт не обновился"
                message="Показаны последние подтверждённые данные. Проверьте сеть и повторите загрузку."
              />
              <PrimaryButton
                title="Повторить загрузку"
                variant="outline"
                compact
                onPress={() => { void reloadDaily({ soft: true }); }}
              />
            </>
          ) : null}
          {asyncHasData(dailyResource) && daily ? (
            <>
              <Text style={s.line}>Расходы: {formatRub(Number(daily.expenses_today || 0))}</Text>
              {(daily.done_today || []).slice(0, 5).map((t, i) => <Text key={i} style={s.meta}>✓ {t}</Text>)}
              <Text style={s.meta}>Завтра: {(daily.planned_tomorrow || []).join(', ') || '—'}</Text>
            </>
          ) : asyncShowError(dailyResource) ? (
            <LoadErrorState
              title="Не удалось загрузить дневной отчёт"
              hint="Ошибка загрузки не означает, что данных нет. Повторите запрос."
              onRetry={() => { void reloadDaily({ soft: false }); }}
            />
          ) : asyncIsLoading(dailyResource) ? (
            <View style={s.loadingRow}>
              <ActivityIndicator color={RenovaTheme.colors.accent} />
              <Text style={s.meta}>Загрузка дневного отчёта…</Text>
            </View>
          ) : null}
          <ReportPdfActions userId={user.id} projectId={activeProject.id} kind="daily" onError={onPdfError} />
        </View>

        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Неделя</Text>
          {asyncShowStale(weeklyResource) ? (
            <>
              <InfoBanner
                tone="warning"
                title="Недельный отчёт не обновился"
                message="Показаны последние подтверждённые данные. Проверьте сеть и повторите загрузку."
              />
              <PrimaryButton
                title="Повторить загрузку"
                variant="outline"
                compact
                onPress={() => { void reloadWeekly({ soft: true }); }}
              />
            </>
          ) : null}
          {asyncHasData(weeklyResource) && weekly ? (
            <>
              <Text style={s.line}>Прогресс: {weekly.progress_percent}%</Text>
              <Text style={s.meta}>План {formatRub(budget.budget_planned || 0)} · Факт {formatRub(budget.budget_spent || 0)}</Text>
              <Text style={s.meta}>Открытых замечаний: {weekly.open_issues_count ?? 0}</Text>
            </>
          ) : asyncShowError(weeklyResource) ? (
            <LoadErrorState
              title="Не удалось загрузить недельный отчёт"
              hint="Ошибка загрузки не означает нулевой прогресс или нулевые расходы. Повторите запрос."
              onRetry={() => { void reloadWeekly({ soft: false }); }}
            />
          ) : asyncIsLoading(weeklyResource) ? (
            <View style={s.loadingRow}>
              <ActivityIndicator color={RenovaTheme.colors.accent} />
              <Text style={s.meta}>Загрузка недельного отчёта…</Text>
            </View>
          ) : null}
          <ReportPdfActions userId={user.id} projectId={activeProject.id} kind="weekly" onError={onPdfError} />
          <HomeLinkRow
            title="Отправить недельный дайджест"
            onPress={async () => {
              try {
                const res = await api.pushWeeklyDigest(user.id, activeProject.id);
                Alert.alert(
                  'Дайджест',
                  `${res.source === 'ollama' ? 'Ollama' : 'Rule-based'} · уведомлений ${res.notified}`,
                );
              } catch (e: unknown) {
                Alert.alert('Дайджест', e instanceof Error ? e.message : 'Не удалось отправить');
              }
            }}
          />
          <HomeLinkRow
            title="Превью дайджеста"
            onPress={async () => {
              try {
                const res = await api.previewWeeklyDigest(user.id, activeProject.id);
                Alert.alert(res.title || 'Превью', (res.body || '').slice(0, 500));
              } catch (e: unknown) {
                Alert.alert('Превью', e instanceof Error ? e.message : 'Ошибка');
              }
            }}
          />
        </View>

        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Финальный отчёт</Text>
          <Text style={s.meta}>После завершения — просмотр в приложении или выгрузка частями</Text>

          {asyncShowStale(finalResource) ? (
            <>
              <InfoBanner
                tone="warning"
                title="Финальный отчёт не обновился"
                message="Показана последняя подтверждённая версия. Проверьте сеть и повторите загрузку."
              />
              <PrimaryButton
                title="Повторить загрузку"
                variant="outline"
                compact
                onPress={() => { void reloadFinal({ soft: true }); }}
              />
            </>
          ) : null}
          {asyncHasData(finalResource) && finalReport ? (
            <FinalReportView data={finalReport} sections={sections} categories={categories} />
          ) : asyncShowError(finalResource) ? (
            <LoadErrorState
              title="Не удалось загрузить финальный отчёт"
              hint="Ошибка загрузки не означает отсутствие итоговых данных. Повторите запрос."
              onRetry={() => { void reloadFinal({ soft: false }); }}
            />
          ) : asyncIsLoading(finalResource) ? (
            <View style={s.loadingRow}>
              <ActivityIndicator color={RenovaTheme.colors.accent} />
              <Text style={s.meta}>Загрузка финального отчёта…</Text>
            </View>
          ) : null}

          <ReportSectionPicker
            sections={sections}
            categories={categories}
            onToggleSection={(id) => setSections((prev) => toggleId(prev, id))}
            onToggleCategory={(id) => setCategories((prev) => toggleId(prev, id))}
          />

          <ReportPdfActions
            userId={user.id}
            projectId={activeProject.id}
            kind="final"
            sections={sections}
            categories={categories}
            onError={onPdfError}
          />

          <HomeLinkRow title="Все документы и CSV расходов" onPress={() => pushOsNav('/documents')} />
        </View>
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  block: { ...card, marginBottom: 12 },
  line: { fontSize: 16, fontWeight: '600', marginTop: 6, marginBottom: 4, color: RenovaTheme.colors.text },
  meta: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 4 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
});