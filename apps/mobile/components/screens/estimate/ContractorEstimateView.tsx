import { useMemo, useState } from 'react';
import { router, usePathname } from 'expo-router';
import { ScrollView, Text, View, StyleSheet, TextInput, Alert } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
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
import { alertChangeOrderSubmitted } from '@/lib/procurementNav';
import { alertEstimateProposed, alertEstimateProposalRevoked } from '@/lib/estimatePayNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { screenLayout } from '@/constants/screenLayout';
import {
  estimateTotals,
  filterEstimateLines,
  type EstimateLineTypeFilter,
} from '@/lib/domain/estimateFilters';

export function ContractorEstimateView() {
  const pathname = usePathname();
  const canWrite = useWriteAllowed();
  const { user, activeProject, loadProject, isContractorOwner, teamRole } = useRenova();
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
  const project = activeProject;

  async function patchLine(lineId: string, body: object) {
    if (!user) return;
    try {
      await api.patchEstimateLine(user.id, project.id, lineId, body);
      // loadProject fetches the committed ProjectDetail and performs project-data
      // reconciliation; do not follow it with a second sync of stale `project`.
      await loadProject(project.id);
    } catch (e: unknown) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Изменение строки');
        return;
      }
      throw e;
    }
  }

  async function addChangeOrder() {
    if (!user) return;
    try {
      await api.createChangeOrder(user.id, project.id, { title: coTitle, amount: parseFloat(coAmount) || 0 });
      await loadProject(project.id);
      // W127: ДО → слой изменений / бюджет после approve (см. EstimateChangesLayer)
      alertChangeOrderSubmitted('contractor');
    } catch (e: unknown) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Допсоглашение');
        return;
      }
      throw e;
    }
  }

  return (
    <>
      <ReadOnlyBanner />
      <ScrollView style={styles.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <ObjectTabGuide tab="estimate" />

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Смета проекта</Text>
          <Text style={styles.total}>{formatRub(project.budget_planned)}</Text>
          {project.estimate_locked_at ? (
            <Text style={styles.locked}>Зафиксирована · {project.estimate_locked_at.slice(0, 10)}</Text>
          ) : null}
          <Text style={styles.breakdown}>
            Работы {formatRub(totals.works)} ({totals.worksCount}) · Материалы {formatRub(totals.materials)} ({totals.materialsCount})
          </Text>
        </View>

        <EstimateSourceLegend />
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

        {user && canWrite && !project.estimate_locked_at && allLines.length > 0 && (
          <>
            <PrimaryButton
              title={project.estimate_lock_proposed_at ? 'Смета у заказчика на согласовании' : 'Отправить смету на согласование'}
              variant="outline"
              disabled={!!project.estimate_lock_proposed_at || !isContractorOwner}
              onPress={async () => {
                try {
                  await api.proposeEstimateLock(user.id, project.id);
                  await loadProject(project.id);
                  alertEstimateProposed('contractor');
                } catch (e: unknown) {
                  Alert.alert('Не удалось', e instanceof Error ? e.message : 'Ошибка отправки сметы');
                }
              }}
            />
            {!isContractorOwner && teamRole && teamRole !== 'owner' ? (
              <Text style={{ color: '#64748B', marginTop: 8 }}>Отправку сметы делает главный исполнитель (не {teamRole}).</Text>
            ) : null}
            {project.estimate_lock_proposed_at ? (
              <PrimaryButton
                title="Отозвать предложение"
                variant="outline"
                onPress={() => {
                  // Clarity U: тот же confirm, что EstimateSummaryLayer (не обходить sheet)
                  showActionConfirm({
                    title: 'Отозвать предложение?',
                    message: 'Смета снова станет черновиком. Заказчик не увидит это предложение.',
                    primaryLabel: 'Отозвать',
                    onPrimary: () => {
                      void (async () => {
                        try {
                          await api.withdrawEstimateLock(user.id, project.id);
                          await loadProject(project.id);
                          alertEstimateProposalRevoked('contractor');
                        } catch (e: unknown) {
                          showActionConfirm({
                            title: 'Не удалось',
                            message: e instanceof Error ? e.message : 'Ошибка отзыва',
                          });
                        }
                      })();
                    },
                    secondaryLabel: 'Отмена',
                    onSecondary: () => undefined,
                  });
                }}
              />
            ) : null}
          </>
        )}

        {user && canWrite && (
          <AddEstimateLineForm
            collapsed
            userId={user.id}
            project={project}
            onSaved={() => loadProject(project.id)}
          />
        )}

        {user && (
          <EstimateOperationsPanel
            userId={user.id}
            projectId={project.id}
            role="contractor"
            rooms={project.rooms || []}
            stages={project.stages || []}
          />
        )}

        <Text style={styles.meta}>{DOCUMENTS_MENU_HINT}</Text>
        <View style={styles.links}>
          <PrimaryButton title="→ Бюджет" variant="outline" onPress={() => pushOsNav(budgetTabRoute('contractor', 'summary'), pathname, 'contractor')} />
          <PrimaryButton title="→ Материалы" variant="outline" onPress={() => pushOsNav(repairTabRoute('contractor', 'materials'), pathname, 'contractor')} />
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
  totalLabel: { ...screenTypography.metricLabel, fontWeight: '600' },
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