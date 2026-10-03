import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, usePathname } from 'expo-router';
import { ScrollView, Text, View, StyleSheet, TextInput } from 'react-native';
import { notifyError } from '@/lib/notify';
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
import { api, type ChangeOrder } from '@/lib/api';
import { EstimateDocumentsLayer } from '@/components/screens/estimate/EstimateDocumentsLayer';
import { ContractorChangeOrdersList } from '@/components/screens/estimate/ContractorChangeOrdersList';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { reportCatch, reportError } from '@/lib/reportError';
import { budgetTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { DOCUMENTS_MENU_HINT } from '@/lib/documentsNav';
import { alertChangeOrderSubmitted } from '@/lib/procurementNav';
import { alertEstimateProposed, alertEstimateProposalRevoked } from '@/lib/estimatePayNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { parsePositiveNumber } from '@/lib/parseLocaleNumber';
import { screenLayout } from '@/constants/screenLayout';
import {
  estimateTotals,
  filterEstimateLines,
  type EstimateLineTypeFilter,
} from '@/lib/domain/estimateFilters';
import { writeResultMessage } from '@/lib/offlineResultMessage';
import { formatScheduleDayFull } from '@/lib/formatScheduleDate';

export function ContractorEstimateView() {
  const pathname = usePathname();
  const canWrite = useWriteAllowed();
  const { user, activeProject, loadProject, isContractorOwner, teamRole } = useRenova();
  // OBJ-06: поля пустые — раньше одно нажатие «Отправить» создавало реальную доп. работу «Доп. розетки 8500 ₽».
  const [coTitle, setCoTitle] = useState('');
  const [coAmount, setCoAmount] = useState('');
  const [coSending, setCoSending] = useState(false);
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ordersFailed, setOrdersFailed] = useState(false);
  const [coStageId, setCoStageId] = useState<string | null>(null);
  const [lineType, setLineType] = useState<EstimateLineTypeFilter>('all');
  const [category, setCategory] = useState<string | null>(null);

  const allLines = activeProject?.estimate_lines || [];
  const filtered = useMemo(
    () => filterEstimateLines(allLines, { lineType, category }),
    [allLines, lineType, category],
  );
  const totals = estimateTotals(allLines);
  const filteredTotal = estimateTotals(filtered).total;
  const userId = user?.id;
  const projectId = activeProject?.id;

  const reloadOrders = useCallback(() => {
    if (!userId || !projectId) return;
    api.listChangeOrders(userId, projectId)
      .then((list) => { setOrders(list); setOrdersFailed(false); setOrdersLoaded(true); })
      .catch((error: unknown) => {
        reportError('components.screens.estimate.ContractorEstimateView.orders', error, { projectId });
        setOrdersFailed(true);
        setOrdersLoaded(true);
      });
  }, [userId, projectId]);
  useEffect(() => { reloadOrders(); }, [reloadOrders]);
  useProjectDataReload(reloadOrders);

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
      // OBJ-08: отказ сервера (смета зафиксирована, нет прав) — сообщаем причину, а не молча
      // оставляем в поле значение, которое не сохранилось.
      reportError('components.screens.estimate.ContractorEstimateView.patchLine', e, { projectId: project.id, lineId });
      notifyError('Строка не сохранена', e, 'Попробуйте ещё раз.');
      await loadProject(project.id).catch(reportCatch('components.screens.estimate.ContractorEstimateView.reloadAfterPatch'));
    }
  }

  async function addChangeOrder() {
    if (!user) return;
    const amount = parsePositiveNumber(coAmount);
    if (!coTitle.trim()) {
      showActionConfirm({ title: 'Допсоглашение', message: 'Укажите название допсоглашения.' });
      return;
    }
    if (amount === null) {
      showActionConfirm({ title: 'Сумма допсоглашения', message: 'Укажите сумму больше 0, например 8 500 или 8500,50.' });
      return;
    }
    if (coSending) return;
    setCoSending(true);
    try {
      await api.createChangeOrder(user.id, project.id, { title: coTitle.trim(), amount, ...(coStageId ? { stage_id: coStageId } : {}) });
      // Форма очищается сразу после принятия сервером: повторное нажатие не создаст дубль.
      setCoTitle('');
      setCoAmount('');
      setCoStageId(null);
      await loadProject(project.id).catch(reportCatch('components.screens.estimate.ContractorEstimateView.reloadAfterCo'));
      reloadOrders();
      // W127: ДО → слой изменений / бюджет после approve (см. EstimateChangesLayer)
      alertChangeOrderSubmitted('contractor');
    } catch (e: unknown) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Допсоглашение');
        return;
      }
      reportError('components.screens.estimate.ContractorEstimateView.createChangeOrder', e, { projectId: project.id });
      notifyError('Доп. работа не отправлена', e, 'Данные остались в форме — повторите отправку.');
    } finally {
      setCoSending(false);
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
            <Text style={styles.locked}>Зафиксирована · {formatScheduleDayFull(project.estimate_locked_at)}</Text>
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
        <EstimateEditorByRoom lines={filtered} canWrite={canWrite} planLocked={Boolean(project.estimate_locked_at)} onPatch={patchLine} />

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
                  notifyError('Не удалось', e, 'Ошибка отправки сметы');
                }
              }}
            />
            {!isContractorOwner && teamRole && teamRole !== 'owner' ? (
              <Text style={{ color: '#64748B', marginTop: 8 }}>Отправку сметы делает главный исполнитель (не {teamRole}).</Text>
            ) : null}
            {project.estimate_lock_proposed_at && isContractorOwner ? (
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
                            message: writeResultMessage(e, 'Ошибка отзыва'),
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

        {user && canWrite && !project.estimate_locked_at && (
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

        {user ? <EstimateDocumentsLayer userId={user.id} projectId={project.id} pathname={pathname} /> : null}
        <Text style={styles.meta}>{DOCUMENTS_MENU_HINT}</Text>
        <View style={styles.links}>
          <PrimaryButton title="→ Бюджет" variant="outline" onPress={() => pushOsNav(budgetTabRoute('contractor', 'summary'), pathname, 'contractor')} />
          <PrimaryButton title="→ Материалы" variant="outline" onPress={() => pushOsNav(repairTabRoute('contractor', 'materials'), pathname, 'contractor')} />
        </View>

        {project.estimate_locked_at ? (
          <Text style={styles.sectionHint}>Смета зафиксирована: новые строки добавляются через доп. работу ниже.</Text>
        ) : null}
        <Text style={styles.section}>Изменение сметы (доп. работа)</Text>
        <Text style={styles.sectionHint}>Отдельная заявка заказчику — не правка строки сметы.</Text>
        <ContractorChangeOrdersList
          orders={orders}
          loaded={ordersLoaded}
          failed={ordersFailed}
          stageName={(stageId) => (stageId ? (project.stages ?? []).find((st) => st.id === stageId)?.name ?? null : null)}
          onRetry={reloadOrders}
        />
        <TextInput style={styles.inpFull} value={coTitle} onChangeText={setCoTitle} placeholder="Название работы, например «Доп. розетки»" />
        <TextInput style={styles.inpFull} value={coAmount} onChangeText={setCoAmount} keyboardType="decimal-pad" placeholder="Сумма, ₽" />
        {(project.stages ?? []).length > 0 ? (
          <>
            <Text style={styles.sectionHint}>Этап (необязательно): счёт допработы привяжется к нему.</Text>
            <View style={styles.links}>
              {(project.stages ?? []).map((st) => (
                <PrimaryButton
                  key={st.id}
                  title={st.name}
                  compact
                  variant={coStageId === st.id ? 'primary' : 'outline'}
                  onPress={() => setCoStageId(coStageId === st.id ? null : st.id)}
                />
              ))}
            </View>
          </>
        ) : null}
        <PrimaryButton disabled={!canWrite || coSending} loading={coSending} title="Отправить на согласование" onPress={addChangeOrder} />
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