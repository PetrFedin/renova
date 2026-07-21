/** Отчёты Renova OS — просмотр in-app + PDF (открыть / поделиться / скачать).
 * Data honesty: daily / weekly / final — независимые load/error; PDF ходит в отдельный endpoint. */
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
import { HomeLinkRow } from '@/components/renova/os/HomeLinkRow';
import { ReportPdfActions } from '@/components/reports/ReportPdfActions';
import { ReportSectionPicker } from '@/components/reports/ReportSectionPicker';
import { FinalReportView } from '@/components/reports/FinalReportView';
import { InlineLoadError } from '@/components/ui/InlineLoadError';
import { StaleDataBanner } from '@/components/ui/StaleDataBanner';
import { api } from '@/lib/api';
import { tabsPrefix, type OsRole } from '@/constants/osSections';
import {
  DEFAULT_FINAL_SECTIONS,
  EXPENSE_CATEGORIES,
  type ExpenseCategoryId,
  type FinalReportSectionId,
} from '@/lib/reports/reportSections';
import type { DailyReport, FinalReport, WeeklyReport } from '@/lib/reports/reportTypes';
import { hasLoadedData, isInitialPending, useAsyncResource } from '@/lib/asyncResource';

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
  const projectId = activeProject?.id;
  const userId = user?.id;
  const enabled = Boolean(userId && projectId);

  const [sections, setSections] = useState<FinalReportSectionId[]>(DEFAULT_FINAL_SECTIONS);
  const [categories, setCategories] = useState<ExpenseCategoryId[]>(EXPENSE_CATEGORIES.map((c) => c.id));

  const dailyFetch = useCallback(
    () => api.reportDaily(userId!, projectId!) as Promise<DailyReport>,
    [userId, projectId],
  );
  const weeklyFetch = useCallback(
    () => api.reportWeekly(userId!, projectId!) as Promise<WeeklyReport>,
    [userId, projectId],
  );
  const finalFetch = useCallback(
    () => api.reportFinal(userId!, projectId!) as Promise<FinalReport>,
    [userId, projectId],
  );

  const { resource: dailyRes, reload: reloadDaily } = useAsyncResource<DailyReport>(dailyFetch, {
    scope: 'app._stack.reports.Daily',
    projectId,
    enabled,
  });
  const { resource: weeklyRes, reload: reloadWeekly } = useAsyncResource<WeeklyReport>(weeklyFetch, {
    scope: 'app._stack.reports.Weekly',
    projectId,
    enabled,
  });
  const { resource: finalRes, reload: reloadFinal } = useAsyncResource<FinalReport>(finalFetch, {
    scope: 'app._stack.reports.FinalReport',
    projectId,
    enabled,
  });

  const reload = useCallback(() => {
    reloadDaily();
    reloadWeekly();
    reloadFinal();
  }, [reloadDaily, reloadWeekly, reloadFinal]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useProjectDataReload(reload);

  const onPdfError = () => Alert.alert('Ошибка', 'Не удалось сформировать PDF. Проверьте сервер.');

  if (!user || !activeProject) {
    return <ProjectEmptyState role={user?.role === 'contractor' ? 'contractor' : 'customer'} title="Нет объекта для отчётов" />;
  }

  const daily = dailyRes.data;
  const weekly = weeklyRes.data;
  const finalReport = finalRes.data;
  const budget = weekly?.budget || {};

  // PDF endpoints (/daily.pdf и т.д.) независимы от JSON preview — не блокируем при ошибке in-app.
  const pdfReady = Boolean(user.id && activeProject.id);

  return (
    <>
      <BackHeader title="Отчёты" returnTo={returnTo || defaultReturnTo} subtitle={activeProject.name} />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Сегодня</Text>
          {dailyRes.stale ? (
            <StaleDataBanner
              message="Дневной отчёт: показаны ранее загруженные данные."
              onRetry={reloadDaily}
              accessibilityRetryLabel="Повторить загрузку дневного отчёта"
            />
          ) : null}
          {hasLoadedData(dailyRes) && daily ? (
            <>
              <Text style={s.line}>Расходы: {formatRub(Number(daily.expenses_today || 0))}</Text>
              {(daily.done_today || []).slice(0, 5).map((t, i) => <Text key={i} style={s.meta}>✓ {t}</Text>)}
              <Text style={s.meta}>Завтра: {(daily.planned_tomorrow || []).join(', ') || '—'}</Text>
            </>
          ) : isInitialPending(dailyRes.status) ? (
            <View style={s.loadingRow}>
              <ActivityIndicator color={RenovaTheme.colors.accent} />
              <Text style={s.meta}>Загрузка дневного отчёта…</Text>
            </View>
          ) : (
            <InlineLoadError
              compact
              title="Дневной отчёт"
              message={dailyRes.error || 'Не удалось загрузить'}
              onRetry={reloadDaily}
              accessibilityRetryLabel="Повторить загрузку дневного отчёта"
            />
          )}
          <ReportPdfActions
            userId={user.id}
            projectId={activeProject.id}
            kind="daily"
            disabled={!pdfReady}
            onError={onPdfError}
          />
        </View>

        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Неделя</Text>
          {weeklyRes.stale ? (
            <StaleDataBanner
              message="Недельный отчёт: показаны ранее загруженные данные."
              onRetry={reloadWeekly}
              accessibilityRetryLabel="Повторить загрузку недельного отчёта"
            />
          ) : null}
          {hasLoadedData(weeklyRes) && weekly ? (
            <>
              <Text style={s.line}>Прогресс: {weekly.progress_percent}%</Text>
              <Text style={s.meta}>План {formatRub(budget.budget_planned || 0)} · Факт {formatRub(budget.budget_spent || 0)}</Text>
              <Text style={s.meta}>Открытых замечаний: {weekly.open_issues_count ?? 0}</Text>
            </>
          ) : isInitialPending(weeklyRes.status) ? (
            <View style={s.loadingRow}>
              <ActivityIndicator color={RenovaTheme.colors.accent} />
              <Text style={s.meta}>Загрузка недельного отчёта…</Text>
            </View>
          ) : (
            <InlineLoadError
              compact
              title="Недельный отчёт"
              message={weeklyRes.error || 'Не удалось загрузить'}
              onRetry={reloadWeekly}
              accessibilityRetryLabel="Повторить загрузку недельного отчёта"
            />
          )}
          <ReportPdfActions
            userId={user.id}
            projectId={activeProject.id}
            kind="weekly"
            disabled={!pdfReady}
            onError={onPdfError}
          />
          <Text style={s.meta}>Push заказчику и исполнителю · rule-based (Ollama опционально)</Text>
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
          <Text style={s.meta}>Без push — проверить текст перед инвестором</Text>
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

          {finalRes.stale ? (
            <StaleDataBanner
              message="Финальный отчёт: показаны ранее загруженные данные."
              onRetry={reloadFinal}
              accessibilityRetryLabel="Повторить загрузку финального отчёта"
            />
          ) : null}

          {hasLoadedData(finalRes) && finalReport ? (
            <FinalReportView data={finalReport} sections={sections} categories={categories} />
          ) : isInitialPending(finalRes.status) ? (
            <View style={s.loadingRow}>
              <ActivityIndicator color={RenovaTheme.colors.accent} />
              <Text style={s.meta}>Загрузка финального отчёта…</Text>
            </View>
          ) : (
            <InlineLoadError
              compact
              title="Финальный отчёт"
              message={finalRes.error || 'Не удалось загрузить'}
              onRetry={reloadFinal}
              accessibilityRetryLabel="Повторить загрузку финального отчёта"
            />
          )}

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
            disabled={!pdfReady}
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
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 },
});
