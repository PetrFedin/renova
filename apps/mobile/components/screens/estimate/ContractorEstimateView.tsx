import { useMemo, useState } from 'react';
import { router, usePathname } from 'expo-router';
import { ScrollView, Text, View, StyleSheet, TextInput, Alert } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { AddEstimateLineForm } from '@/components/renova/AddEstimateLineForm';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { EstimateFilterBar } from '@/components/renova/estimate/EstimateFilterBar';
import { EstimateSourceLegend } from '@/components/renova/estimate/EstimateSourceLegend';
import { EstimateEditorByRoom } from '@/components/renova/estimate/EstimateEditorByRoom';
import { EstimateOperationsPanel } from '@/components/renova/estimate/EstimateOperationsPanel';
import { ObjectTabGuide } from '@/components/screens/object/ObjectTabGuide';
import { api } from '@/lib/api';
import { budgetTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { DOCUMENTS_MENU_HINT } from '@/lib/documentsNav';
import { screenLayout } from '@/constants/screenLayout';
import {
  estimateTotals,
  filterEstimateLines,
  type EstimateLineTypeFilter,
} from '@/lib/domain/estimateFilters';

export function ContractorEstimateView() {
  const pathname = usePathname();
  const canWrite = useWriteAllowed();
  const { user, activeProject, loadProject } = useRenova();
  const [coTitle, setCoTitle] = useState('Доп. розетки');
  const [coAmount, setCoAmount] = useState('8500');
  const [lineType, setLineType] = useState<EstimateLineTypeFilter>('all');
  const [category, setCategory] = useState<string | null>(null);

  const allLines = activeProject?.estimate_lines || [];
  const filtered = useMemo(
    () => filterEstimateLines(allLines, { lineType, category }),
    [allLines, lineType, category],
  );
  const totals = estimateTotals(allLines);
  const filteredTotal = estimateTotals(filtered).total;

  if (!activeProject) {
    return <ProjectEmptyState role="contractor" />;
  }

  async function patchLine(lineId: string, body: object) {
    if (!user) return;
    await api.patchEstimateLine(user.id, activeProject!.id, lineId, body);
    await loadProject(activeProject!.id);
  }

  async function addChangeOrder() {
    if (!user) return;
    await api.createChangeOrder(user.id, activeProject.id, { title: coTitle, amount: parseFloat(coAmount) || 0 });
    await loadProject(activeProject.id);
    Alert.alert('Изменение сметы', 'Отправлен заказчику на согласование');
  }

  return (
    <>
      <ReadOnlyBanner />
      <ScrollView style={styles.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <ObjectTabGuide tab="estimate" compact />

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Смета проекта</Text>
          <Text style={styles.total}>{formatRub(activeProject.budget_planned)}</Text>
          {activeProject.estimate_locked_at ? (
            <Text style={styles.locked}>Зафиксирована · {activeProject.estimate_locked_at.slice(0, 10)}</Text>
          ) : null}
          <Text style={styles.breakdown}>
            Работы {formatRub(totals.works)} ({totals.worksCount}) · Материалы {formatRub(totals.materials)} ({totals.materialsCount})
          </Text>
        </View>

        <EstimateSourceLegend compact />
        <EstimateFilterBar
          lines={allLines}
          lineType={lineType}
          category={category}
          onLineType={setLineType}
          onCategory={setCategory}
        />

        <Text style={styles.sectionTitle}>
          Редактор · {filtered.length} поз. · {formatRub(filteredTotal)}
        </Text>
        <EstimateEditorByRoom lines={filtered} canWrite={canWrite} onPatch={patchLine} />

        {user && canWrite && !activeProject.estimate_locked_at && allLines.length > 0 && (
          <PrimaryButton
            title="Зафиксировать смету"
            variant="outline"
            onPress={async () => {
              try {
                const res = await api.lockEstimate(user.id, activeProject.id);
                await loadProject(activeProject.id);
                Alert.alert(
                  'Смета зафиксирована',
                  res.contract?.pending_titles?.length
                    ? `Создан черновик: ${res.contract.pending_titles.join(', ')}. Заказчик получит уведомление.`
                    : 'Заказчик получит уведомление о подписи договора.',
                );
              } catch (e: unknown) {
                Alert.alert('Не удалось', e instanceof Error ? e.message : 'Ошибка фиксации сметы');
              }
            }}
          />
        )}

        {user && canWrite && (
          <AddEstimateLineForm
            collapsed
            userId={user.id}
            project={activeProject}
            onSaved={() => loadProject(activeProject.id)}
          />
        )}

        {user && (
          <EstimateOperationsPanel
            userId={user.id}
            projectId={activeProject.id}
            role="contractor"
            rooms={activeProject.rooms || []}
            stages={activeProject.stages || []}
          />
        )}

        <Text style={styles.meta}>{DOCUMENTS_MENU_HINT}</Text>
        <View style={styles.links}>
          <PrimaryButton title="→ Бюджет" variant="outline" compact onPress={() => pushOsNav(budgetTabRoute('contractor', 'summary'), pathname)} />
          <PrimaryButton title="→ Материалы" variant="outline" compact onPress={() => pushOsNav(repairTabRoute('contractor', 'materials'), pathname)} />
        </View>

        <Text style={styles.section}>Изменение сметы (доп. работа)</Text>
        <Text style={styles.sectionHint}>Отдельная заявка заказчику — не правка строки сметы.</Text>
        <TextInput style={styles.inpFull} value={coTitle} onChangeText={setCoTitle} placeholder="Название работы" />
        <TextInput style={styles.inpFull} value={coAmount} onChangeText={setCoAmount} keyboardType="decimal-pad" placeholder="Сумма" />
        <PrimaryButton disabled={!canWrite} title="Отправить на согласование" onPress={addChangeOrder} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  totalBox: { marginBottom: 12 },
  totalLabel: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  total: { fontSize: 28, fontWeight: '800', color: RenovaTheme.colors.primary, marginTop: 4 },
  locked: { fontSize: 12, color: RenovaTheme.colors.warningText, marginTop: 4, fontWeight: '600' },
  breakdown: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 16 },
  sectionTitle: { fontWeight: '700', fontSize: 13, marginBottom: 8, color: RenovaTheme.colors.text },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 16, marginTop: 8 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  section: { fontWeight: '700', marginTop: 16, marginBottom: 4, fontSize: 16 },
  sectionHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  inpFull: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 12, marginBottom: 8, backgroundColor: RenovaTheme.colors.surface },
});
