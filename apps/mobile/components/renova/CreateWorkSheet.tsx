/** Создание WorkOrder — единая форма «Работа» */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { BudgetPlannerPanel } from '@/components/renova/BudgetPlannerPanel';
import { WorkFormSection } from '@/components/renova/WorkFormSection';
import { api, type Room, type WorkOrder } from '@/lib/api';
import { buildRoomCalc } from '@/lib/calc-engine';
import { WORK_TYPE_CATALOG, WORK_TYPE_CATEGORIES, WORK_FORM_HINTS, workTypeName } from '@/constants/workTypes';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { alertCreateWorkSuccess } from '@/lib/createSuccessNav';
import type { OsRole } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportError } from '@/lib/reportError';
import { useRenova } from '@/lib/context/RenovaContext';
import { createClientRequestId } from '@/lib/clientRequestId';

export type CreateWorkVariant = 'contractor' | 'customer';

type Props = {
  visible: boolean;
  userId: string;
  projectId: string;
  rooms: Room[];
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
  /** W138: вернуть созданный WO (scratchpad promotion / deep-link) */
  onCreatedWork?: (work: WorkOrder) => void | Promise<void>;
  variant?: CreateWorkVariant;
  defaultTitle?: string;
  defaultRoomId?: string;
  defaultStart?: string;
  defaultEnd?: string;
  defaultBudget?: number;
};

export function CreateWorkSheet({
  visible,
  userId,
  projectId,
  rooms,
  onClose,
  onCreated,
  onCreatedWork,
  variant = 'contractor',
  defaultTitle,
  defaultRoomId,
  defaultStart,
  defaultEnd,
  defaultBudget,
}: Props) {
  const { user, activeProject, loadProject } = useRenova();
  const [category, setCategory] = useState(WORK_TYPE_CATEGORIES[0].id);
  const [workType, setWorkType] = useState('custom');
  const [customTitle, setCustomTitle] = useState(defaultTitle || '');
  const [roomId, setRoomId] = useState<string | undefined>(defaultRoomId);
  const [plannedStart, setPlannedStart] = useState(defaultStart || '');
  const [plannedEnd, setPlannedEnd] = useState(defaultEnd || '');
  const [budget, setBudget] = useState(defaultBudget ? String(defaultBudget) : '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'form' | 'calculator'>('form');
  const [regionCode, setRegionCode] = useState('RU-MOW');
  const [complexity, setComplexity] = useState(1);
  const [laborShare, setLaborShare] = useState(0.45);
  const requestIdRef = useRef(createClientRequestId('work-order'));
  const isCustomer = variant === 'customer';

  useEffect(() => {
    if (!visible) return;
    requestIdRef.current = createClientRequestId('work-order');
    setCategory(WORK_TYPE_CATEGORIES[0].id);
    setWorkType('custom');
    setCustomTitle(defaultTitle || '');
    setRoomId(defaultRoomId);
    setPlannedStart(defaultStart || '');
    setPlannedEnd(defaultEnd || '');
    setBudget(defaultBudget ? String(defaultBudget) : '');
    setNotes('');
    setBusy(false);
    setTab('form');
  }, [visible, defaultTitle, defaultRoomId, defaultStart, defaultEnd, defaultBudget]);

  const typesInCategory = useMemo(
    () => WORK_TYPE_CATALOG.filter((t) => t.category === category),
    [category],
  );
  const selectedRoom = rooms.find((r) => r.id === roomId);
  const selected = WORK_TYPE_CATALOG.find((t) => t.code === workType);
  const title = (customTitle.trim() || selected?.name || workTypeName(workType)).trim();
  const budgetNum = Number(String(budget).replace(',', '.')) || 0;
  const metrics = useMemo(() => buildRoomCalc(selectedRoom || null), [selectedRoom]);
  const calcWorks = useMemo(
    () => metrics
      ? {
          floorArea: metrics.floorArea,
          wallArea: metrics.wallArea,
          perimeter: metrics.perimeter,
        }
      : undefined,
    [metrics],
  );
  const calcEstimate = useMemo(() => {
    const m = calcWorks;
    if (!m || !selected) return null;
    const qty = selected.metric === 'floor_area' ? m.floorArea
      : selected.metric === 'wall_area' ? m.wallArea
        : selected.metric === 'perimeter' ? m.perimeter
          : selected.metric === 'point' ? 1
            : 1;
    const price = selected.default_price_rub || 0;
    const base = qty * price;
    return base > 0 ? Math.round(base * complexity) : null;
  }, [calcWorks, selected, complexity]);
  const daysEst = useMemo(() => {
    const selectedType = WORK_TYPE_CATALOG.find((t) => t.code === workType);
    const productivity = selectedType?.productivity_per_day || 0;
    if (!productivity || !metrics) return null;
    const qty = selectedType.metric === 'floor_area' ? metrics.floorArea
      : selectedType.metric === 'wall_area' ? metrics.wallArea
        : selectedType.metric === 'perimeter' ? metrics.perimeter
          : 1;
    return Math.max(1, Math.ceil((qty / productivity) * complexity));
  }, [workType, metrics, complexity]);

  const onEstimate = (estimated: { total: number }) => {
    if (estimated.total > 0) setBudget(String(Math.round(estimated.total)));
  };

  const submit = async (publish: boolean) => {
    if (busy || !title) return;
    setBusy(true);
    let created: WorkOrder | null = null;
    try {
      created = await api.createWorkOrder(userId, projectId, {
        work_type: workType,
        title,
        room_id: roomId || null,
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        budget_planned: budgetNum,
        notes: notes || null,
        client_request_id: requestIdRef.current,
      });
      if (publish && created.status === 'draft') {
        created = await api.patchWorkOrder(userId, projectId, created.id, { status: 'planned' });
      }
    } catch (e: unknown) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Работа');
        onClose();
        return;
      }
      showActionConfirm({
        title: 'Не удалось создать работу',
        message: e instanceof Error ? e.message : 'Попробуйте ещё раз',
      });
      return;
    } finally {
      setBusy(false);
    }

    if (!created) return;
    requestIdRef.current = createClientRequestId('work-order');

    // The mutation is already committed. Reconcile through a fresh ProjectDetail;
    // never propagate the pre-mutation activeProject into inbox/home side effects.
    try {
      if (user?.id === userId && activeProject?.id === projectId) {
        await loadProject(projectId);
      } else {
        reportError(
          'createWorkSheet.contextMissing',
          new Error('work committed without matching active Renova context'),
          { userId, projectId, activeUserId: user?.id, activeProjectId: activeProject?.id },
        );
      }
    } catch (e) {
      reportError('createWorkSheet.projectRefresh', e, { projectId, workOrderId: created.id });
    }

    try {
      await onCreatedWork?.(created);
    } catch (e) {
      reportError('createWorkSheet.onCreatedWork', e, { projectId, workOrderId: created.id });
    }

    try {
      await onCreated?.();
    } catch (e) {
      reportError('createWorkSheet.onCreated', e, { projectId, workOrderId: created.id });
    }

    try {
      alertCreateWorkSuccess((isCustomer ? 'customer' : 'contractor') as OsRole, created.id, {
        title: created.title,
        plannedStart: created.planned_start,
      });
    } catch (e) {
      reportError('createWorkSheet.successUi', e, { projectId, workOrderId: created.id });
    }
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.head}>{isCustomer ? 'Добавить работу в план' : 'Новая работа'}</Text>
          <Text style={s.guide}>
            {isCustomer
              ? 'Что нужно сделать, где и когда. Сумму можно оставить пустой — исполнитель уточнит.'
              : 'Сначала заполните основное. Калькулятор — отдельная вкладка, ничего не пересчитает без вашего действия.'}
          </Text>

          {!isCustomer ? (
            <View style={s.tabs}>
              <Pressable style={[s.tab, tab === 'form' && s.tabOn]} onPress={() => setTab('form')}>
                <Text style={[s.tabT, tab === 'form' && s.tabTOn]}>Заполнение</Text>
              </Pressable>
              <Pressable style={[s.tab, tab === 'calculator' && s.tabOn]} onPress={() => setTab('calculator')}>
                <Text style={[s.tabT, tab === 'calculator' && s.tabTOn]}>Калькулятор</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={s.preview}>
            <Text style={s.previewLabel}>Будет создано</Text>
            <Text style={s.previewVal} numberOfLines={2}>{title || 'Работа без названия'}</Text>
            <Text style={s.previewLabel}>
              {selectedRoom?.name || 'Весь объект'}
              {plannedStart ? ` · ${plannedStart}` : ''}
              {plannedEnd ? ` → ${plannedEnd}` : ''}
              {budgetNum > 0 ? ` · ${formatRub(budgetNum)}` : ''}
            </Text>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
            {tab === 'form' || isCustomer ? (
              <>
                <WorkFormSection title="Что" hint={WORK_FORM_HINTS.what}>
                  <Text style={s.fieldLabel}>Категория</Text>
                  <View style={s.chips}>
                    {WORK_TYPE_CATEGORIES.map((c) => (
                      <Pressable
                        key={c.id}
                        style={[s.chip, category === c.id && s.chipOn]}
                        onPress={() => { setCategory(c.id); setWorkType('custom'); }}
                      >
                        <Text style={[s.chipT, category === c.id && s.chipTOn]}>{c.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={s.fieldLabel}>Тип</Text>
                  <View style={s.chips}>
                    {typesInCategory.map((t) => (
                      <Pressable
                        key={t.code}
                        style={[s.chip, workType === t.code && s.chipOn]}
                        onPress={() => setWorkType(t.code)}
                      >
                        <Text style={[s.chipT, workType === t.code && s.chipTOn]}>{t.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={s.fieldLabel}>
                    {workType === 'custom' ? 'Название' : 'Уточнение (необязательно)'}
                  </Text>
                  <TextInput
                    style={s.input}
                    value={customTitle}
                    onChangeText={setCustomTitle}
                    placeholder={selected?.name || 'Например: 3 розетки у окна'}
                  />
                </WorkFormSection>

                <WorkFormSection title="Где" hint={WORK_FORM_HINTS.where}>
                  <View style={s.chips}>
                    <Pressable style={[s.chip, !roomId && s.chipOn]} onPress={() => setRoomId(undefined)}>
                      <Text style={[s.chipT, !roomId && s.chipTOn]}>Общее</Text>
                    </Pressable>
                    {rooms.map((r) => (
                      <Pressable
                        key={r.id}
                        style={[s.chip, roomId === r.id && s.chipOn]}
                        onPress={() => setRoomId(r.id)}
                      >
                        <Text style={[s.chipT, roomId === r.id && s.chipTOn]}>{r.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </WorkFormSection>

                <WorkFormSection title="Когда" hint={WORK_FORM_HINTS.when}>
                  <View style={s.dateRow}>
                    <View style={s.dateCol}>
                      <TextInput
                        style={s.input}
                        value={plannedStart}
                        onChangeText={setPlannedStart}
                        placeholder="2026-07-06"
                      />
                      <Text style={s.dateHint}>{isCustomer ? 'День' : 'Старт'}</Text>
                    </View>
                    <View style={s.dateCol}>
                      <TextInput
                        style={s.input}
                        value={plannedEnd}
                        onChangeText={setPlannedEnd}
                        placeholder="2026-07-10"
                      />
                      <Text style={s.dateHint}>{isCustomer ? 'До (необяз.)' : 'Финиш'}</Text>
                    </View>
                  </View>
                </WorkFormSection>

                <WorkFormSection title="Бюджет" hint={WORK_FORM_HINTS.budget}>
                  <TextInput
                    style={s.input}
                    value={budget}
                    onChangeText={setBudget}
                    keyboardType="numeric"
                    placeholder="0 — уточните позже"
                  />
                  {daysEst && !isCustomer ? <Text style={s.metaHint}>Из калькулятора: ~{daysEst} дн.</Text> : null}
                  {!isCustomer ? (
                  <Pressable onPress={() => setTab('calculator')}>
                    <Text style={s.link}>→ Рассчитать во вкладке «Калькулятор»</Text>
                  </Pressable>
                  ) : null}
                </WorkFormSection>

                <WorkFormSection title={isCustomer ? 'Примечание' : 'Для исполнителя'} hint={WORK_FORM_HINTS.notes}>
                  <TextInput
                    style={[s.input, s.area]}
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    placeholder="Доступ, материалы, ограничения…"
                  />
                </WorkFormSection>
              </>
            ) : (
              <View style={s.calcWrap}>
                <Text style={s.calcHint}>{WORK_FORM_HINTS.calculator}</Text>
                {!selectedRoom ? (
                  <Text style={s.calcWarn}>Выберите комнату на вкладке «Заполнение» — расчёт точнее.</Text>
                ) : null}
                <BudgetPlannerPanel
                  workTypes={[workType]}
                  onWorkTypesChange={(t) => setWorkType(t[0] || workType)}
                  regionCode={regionCode}
                  onRegionChange={setRegionCode}
                  metrics={metrics}
                  onMetricsChange={() => {}}
                  complexity={complexity}
                  onComplexityChange={setComplexity}
                  laborShare={laborShare}
                  onLaborShareChange={setLaborShare}
                  onEstimate={onEstimate}
                  compact
                />
              </View>
            )}
          </ScrollView>

          <View style={s.actions}>
            {isCustomer ? (
              <>
                <PrimaryButton title="Добавить в план" disabled={busy} onPress={() => submit(true)} />
                <PrimaryButton title="Отмена" variant="outline" disabled={busy} onPress={onClose} />
              </>
            ) : (
              <>
                <PrimaryButton title="Черновик" variant="outline" disabled={busy} onPress={() => submit(false)} />
                <PrimaryButton title="Опубликовать" disabled={busy} onPress={() => submit(true)} />
                <PrimaryButton title="Отмена" variant="outline" disabled={busy} onPress={onClose} />
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { ...card, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: 16, maxHeight: '92%' },
  head: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  guide: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 10 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: RenovaTheme.colors.border, alignItems: 'center' },
  tabOn: { backgroundColor: RenovaTheme.colors.infoBg },
  tabT: { fontWeight: '600', color: RenovaTheme.colors.textMuted, fontSize: 13 },
  tabTOn: { color: RenovaTheme.colors.accent },
  preview: {
    backgroundColor: RenovaTheme.colors.infoBg,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  previewLabel: { ...screenTypography.metricLabel, marginTop: 0 },
  previewVal: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text, marginTop: 2 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.text, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: RenovaTheme.colors.border,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  chipOn: { backgroundColor: RenovaTheme.colors.infoBg, borderColor: RenovaTheme.colors.accent },
  chipT: { fontSize: 12, fontWeight: '600', color: '#333' },
  chipTOn: { color: RenovaTheme.colors.accent },
  input: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 8,
    padding: 10,
    backgroundColor: RenovaTheme.colors.surface,
    fontSize: 15,
  },
  area: { minHeight: 72, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateCol: { flex: 1, gap: 4 },
  dateHint: { fontSize: 11, color: RenovaTheme.colors.textSubtle },
  metaHint: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  link: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary, marginTop: 4 },
  calcWrap: { gap: 8 },
  calcHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 4 },
  calcWarn: { fontSize: 12, color: '#92400E', backgroundColor: '#FFFBEB', padding: 8, borderRadius: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
});