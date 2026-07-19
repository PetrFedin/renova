/** Отчёты Renova OS — просмотр in-app + PDF (открыть / поделиться / скачать) */
import { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { homeTypography } from '@/constants/homeTypography';
import { useRenova } from '@/lib/context/RenovaContext';
import { BackHeader } from '@/components/renova/BackHeader';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { HomeLinkRow } from '@/components/renova/os/HomeLinkRow';
import { ReportPdfActions } from '@/components/reports/ReportPdfActions';
import { ReportSectionPicker } from '@/components/reports/ReportSectionPicker';
import { FinalReportView } from '@/components/reports/FinalReportView';
import { api } from '@/lib/api';
import { tabsPrefix, type OsRole } from '@/constants/osSections';
import {
  DEFAULT_FINAL_SECTIONS,
  EXPENSE_CATEGORIES,
  type ExpenseCategoryId,
  type FinalReportSectionId,
} from '@/lib/reports/reportSections';
import type { DailyReport, FinalReport, WeeklyReport } from '@/lib/reports/reportTypes';

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
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [finalReport, setFinalReport] = useState<FinalReport | null>(null);
  const [sections, setSections] = useState<FinalReportSectionId[]>(DEFAULT_FINAL_SECTIONS);
  const [categories, setCategories] = useState<ExpenseCategoryId[]>(EXPENSE_CATEGORIES.map((c) => c.id));

  const reload = useCallback(async () => {
    if (!user || !activeProject) return;
    api.reportDaily(user.id, activeProject.id).then((d) => setDaily(d as DailyReport)).catch(() => setDaily(null));
    api.reportWeekly(user.id, activeProject.id).then((d) => setWeekly(d as WeeklyReport)).catch(() => setWeekly(null));
    api.reportFinal(user.id, activeProject.id).then((d) => setFinalReport(d as FinalReport)).catch(() => setFinalReport(null));
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reload().catch(() => {}); }, [reload]));

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
          {daily ? (
            <>
              <Text style={s.line}>Расходы: {formatRub(Number(daily.expenses_today || 0))}</Text>
              {(daily.done_today || []).slice(0, 5).map((t, i) => <Text key={i} style={s.meta}>✓ {t}</Text>)}
              <Text style={s.meta}>Завтра: {(daily.planned_tomorrow || []).join(', ') || '—'}</Text>
            </>
          ) : <Text style={s.meta}>Загрузка…</Text>}
          <ReportPdfActions userId={user.id} projectId={activeProject.id} kind="daily" onError={onPdfError} />
        </View>

        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Неделя</Text>
          {weekly ? (
            <>
              <Text style={s.line}>Прогресс: {weekly.progress_percent}%</Text>
              <Text style={s.meta}>План {formatRub(budget.budget_planned || 0)} · Факт {formatRub(budget.budget_spent || 0)}</Text>
              <Text style={s.meta}>Открытых замечаний: {weekly.open_issues_count ?? 0}</Text>
            </>
          ) : <Text style={s.meta}>Загрузка…</Text>}
          <ReportPdfActions userId={user.id} projectId={activeProject.id} kind="weekly" onError={onPdfError} />
          <HomeLinkRow
            title="Отправить недельный дайджест"
            subtitle="Push заказчику и исполнителю · rule-based (Ollama опционально)"
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
            subtitle="Без push — проверить текст перед инвестором"
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

          {finalReport ? (
            <FinalReportView data={finalReport} sections={sections} categories={categories} />
          ) : (
            <Text style={s.meta}>Загрузка…</Text>
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
            onError={onPdfError}
          />

          <HomeLinkRow title="Все документы и CSV расходов" onPress={() => router.push('/documents' as any)} />
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
});
