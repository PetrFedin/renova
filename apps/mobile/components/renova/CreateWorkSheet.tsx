/** Форма создания работы — секции: что · где · когда · бюджет */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { notifyAlert, notifyError } from '@/lib/notify';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { WORK_TYPES_FALLBACK, type WorkTypeOption } from '@/constants/workCatalog';
import { WORK_CATEGORIES, WORK_FORM_HINTS } from '@/constants/workFormHints';
import { BudgetPlannerPanel } from '@/components/renova/BudgetPlannerPanel';
import { WorkFormSection } from '@/components/renova/work/WorkFormSection';
import type { MarketEstimate } from '@/constants/regions';
import { calcRoomMetrics } from '@/lib/calc-engine';
import { api, Room, isRateLimitError } from '@/lib/api';
import { parseNonNegativeNumber } from '@/lib/parseLocaleNumber';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { alertWorkCreated } from '@/lib/fieldCreateNav';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import type { OsRole } from '@/constants/osSections';
import { reportError } from '@/lib/reportError';
import { SheetSurface } from '@/components/renova/SheetSurface';
import { checkDateRange, parseDateInput } from '@/lib/validateDate';

type Props = {
  visible: boolean;
  onClose: () => void;
  userId: string;
  projectId: string;
  rooms: Room[];
  defaultRoomId?: string;
  defaultDate?: string;
  /** Предзаполнение из черновика */
  defaultTitle?: string;
  /** customer — задачи в план без калькулятора; contractor — полная форма */
  variant?: 'customer' | 'contractor';
  onCreated: () => void | Promise<void>;
  onCreatedWork?: (wo: import('@/lib/api').WorkOrder) => void | Promise<void>;
};

type FormTab = 'form' | 'calculator';

function dedupeTypes(types: WorkTypeOption[]) {
  const seen = new Set<string>();
  return types.filter((t) => {
    if (seen.has(t.code)) return false;
    seen.add(t.code);
    return true;
  });
}

export function CreateWorkSheet({
  visible,
  onClose,
  userId,
  projectId,
  rooms,
  defaultRoomId,
  defaultDate,
  defaultTitle,
  variant = 'contractor',
  onCreated,
  onCreatedWork,
}: Props) {
  const { user, activeProject } = useRenova();
  const isCustomer = variant === 'customer';
  const [types, setTypes] = useState(WORK_TYPES_FALLBACK);
  const [workType, setWorkType] = useState('electrical');
  const [category, setCategory] = useState('engineering');
  const [customTitle, setCustomTitle] = useState('');
  const [roomId, setRoomId] = useState<string | undefined>(defaultRoomId);
  const [plannedStart, setPlannedStart] = useState(defaultDate || new Date().toISOString().slice(0, 10));
  const [plannedEnd, setPlannedEnd] = useState(defaultDate || new Date().toISOString().slice(0, 10));
  const [budget, setBudget] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [tab, setTab] = useState<FormTab>('form');
  const [regionCode, setRegionCode] = useState('moscow');
  const [complexity, setComplexity] = useState(1);
  const [laborShare, setLaborShare] = useState(0.5);
  const [daysEst, setDaysEst] = useState<number | null>(null);

  const cleanTypes = useMemo(() => dedupeTypes(types), [types]);
  const selectedRoom = rooms.find((r) => r.id === roomId);
  const selected = cleanTypes.find((t) => t.code === workType);
  const typesInCategory = useMemo(
    () => cleanTypes.filter((t) => (t.category || 'other') === category),
    [cleanTypes, category],
  );

  const metrics = useMemo(() => {
    if (!selectedRoom) {
      return { floor_sq_m: 12, wall_sq_m: 24, perimeter_m: 14, outlets_count: 0, plumbing_points: 0 };
    }
    const m = calcRoomMetrics({
      lengthM: selectedRoom.length_m,
      widthM: selectedRoom.width_m,
      heightM: selectedRoom.height_m,
      openingsSqM: selectedRoom.openings_sq_m ?? 2,
    });
    return {
      floor_sq_m: m.floorSqM,
      wall_sq_m: m.wallSqM,
      perimeter_m: m.perimeterM,
      outlets_count: selectedRoom.outlets_count || 0,
      plumbing_points: selectedRoom.plumbing_points || 0,
    };
  }, [selectedRoom]);

  const title = workType === 'custom' ? customTitle.trim() : customTitle.trim() || selected?.name || 'Работа';
  const preview = [title, selectedRoom?.name].filter(Boolean).join(' · ');

  useEffect(() => {
    api.listWorkTypes().then((list) => setTypes(dedupeTypes(list))).catch(() => setTypes(WORK_TYPES_FALLBACK));
  }, []);

  useEffect(() => {
    if (defaultRoomId) setRoomId(defaultRoomId);
    if (defaultDate) {
      setPlannedStart(defaultDate);
      setPlannedEnd(defaultDate);
    }
    if (visible && defaultTitle) {
      setCustomTitle(defaultTitle);
      setWorkType('custom');
    }
    if (visible) setTab('form');
  }, [defaultRoomId, defaultDate, defaultTitle, visible]);

  useEffect(() => {
    const cat = selected?.category || 'other';
    if (cat !== category) setCategory(cat);
  }, [workType, selected?.category]);

  const pickCategory = (catId: string) => {
    setCategory(catId);
    const first = cleanTypes.find((t) => (t.category || 'other') === catId);
    if (first) setWorkType(first.code);
  };

  const onEstimate = (est: MarketEstimate) => {
    setBudget(String(Math.round(est.grand_total)));
    setDaysEst(est.days_estimated);
    const startIso = parseDateInput(plannedStart);
    if (est.days_estimated && startIso) {
      const d = new Date(`${startIso}T12:00:00`);
      d.setDate(d.getDate() + Math.ceil(est.days_estimated));
      setPlannedEnd(d.toISOString().slice(0, 10));
    }
    setTab('form');
    notifyAlert('Расчёт', `Сумма ${formatRub(est.grand_total)} подставлена в форму`);
  };

  async function submit(publish: boolean) {
    if (!title) {
      notifyAlert('Работа', 'Укажите тип или название');
      return;
    }
    const budgetNum = budget.trim() ? parseNonNegativeNumber(budget) : 0;
    if (budgetNum === null) {
      notifyAlert('Бюджет работы', 'Введите бюджет числом, например 25 000 или 25000,50.');
      return;
    }
    const dates = checkDateRange(plannedStart, plannedEnd, { start: isCustomer ? 'День' : 'Старт', end: isCustomer ? 'До' : 'Финиш' });
    if (!dates.ok) {
      setDateError(dates.error);
      return;
    }
    setDateError(null);
    if (busy) return;
    setBusy(true);
    try {
      let wo: import('@/lib/api').WorkOrder;
      try {
        wo = await api.createWorkOrder(userId, projectId, {
          title,
          work_type: workType,
          room_id: roomId || null,
          planned_start: dates.start ?? null,
          planned_end: dates.end ?? dates.start ?? null,
          budget_planned: budgetNum,
          notes: notes || null,
          publish,
        });
      } catch (error) {
        if (isRateLimitError(error)) {
          notifyAlert('Подождите', 'Слишком много запросов. Повторите через несколько секунд.');
        } else if (isOfflineQueued(error) || (error instanceof Error && error.message === 'offline_queued')) {
          notifyOfflineQueued('Создание работы', variant === 'customer' ? 'customer' : 'contractor');
          onClose();
        } else {
          reportError('createWorkSheet.create', error, { projectId });
          notifyError('Ошибка', error, 'Не удалось создать работу');
        }
        return;
      }

      // Work order is committed. Everything below is best-effort follow-up and
      // must never turn the successful mutation into a false creation failure.
      if (user?.id === userId && activeProject?.id === projectId) {
        try {
          await syncProjectSideEffects({ user, project: activeProject });
        } catch (error) {
          reportError('createWorkSheet.sideEffects', error, { projectId, workOrderId: wo.id });
        }
      } else {
        reportError(
          'createWorkSheet.contextMismatch',
          new Error('Committed work order has no matching active Renova context'),
          { projectId, userId, workOrderId: wo.id },
        );
      }

      try {
        await onCreatedWork?.(wo);
      } catch (error) {
        reportError('createWorkSheet.onCreatedWork', error, { projectId, workOrderId: wo.id });
      }
      try {
        await onCreated();
      } catch (error) {
        reportError('createWorkSheet.onCreated', error, { projectId, workOrderId: wo.id });
      }

      onClose();
      setCustomTitle('');
      setNotes('');
      setBudget('');
      // W133: работа → график / карточка
      const role = (isCustomer ? 'customer' : 'contractor') as OsRole;
      alertWorkCreated(role, wo.id);
    } finally {
      setBusy(false);
    }
  }

  const footer = isCustomer ? (
    <>
      <PrimaryButton title="Добавить в план" loading={busy} disabled={busy} onPress={() => submit(true)} />
      <PrimaryButton title="Отмена" variant="outline" disabled={busy} onPress={onClose} />
    </>
  ) : (
    <>
      <PrimaryButton title="Опубликовать" loading={busy} disabled={busy} onPress={() => submit(true)} />
      <PrimaryButton title="Черновик" variant="outline" disabled={busy} onPress={() => submit(false)} />
      <PrimaryButton title="Отмена" variant="ghost" disabled={busy} onPress={onClose} />
    </>
  );

  return (
    <SheetSurface
      visible={visible}
      onClose={onClose}
      busy={busy}
      title={isCustomer ? 'Задача на день' : 'Новая работа'}
      subtitle={isCustomer ? 'Можно несколько задач в один день — каждая отдельной строкой в календаре.' : WORK_FORM_HINTS.guide}
      footer={footer}
    >
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

          <View>
            {tab === 'form' || isCustomer ? (
              <>
                {preview ? (
                  <View style={s.preview}>
                    <Text style={s.previewLabel}>Будет создано</Text>
                    <Text style={s.previewVal}>{preview}</Text>
                  </View>
                ) : null}

                <WorkFormSection title="Что делаем" hint={WORK_FORM_HINTS.what}>
                  <Text style={s.fieldLabel}>Категория</Text>
                  <View style={s.chips}>
                    {WORK_CATEGORIES.map((c) => (
                      <Pressable
                        key={c.id}
                        style={[s.chip, category === c.id && s.chipOn]}
                        onPress={() => pickCategory(c.id)}
                      >
                        <Text style={[s.chipT, category === c.id && s.chipTOn]}>{c.label}</Text>
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
                        onChangeText={(v: string) => { setPlannedStart(v); setDateError(null); }}
                        placeholder="ДД.ММ.ГГГГ"
                      />
                      <Text style={s.dateHint}>{isCustomer ? 'День' : 'Старт'}</Text>
                    </View>
                    <View style={s.dateCol}>
                      <TextInput
                        style={s.input}
                        value={plannedEnd}
                        onChangeText={(v: string) => { setPlannedEnd(v); setDateError(null); }}
                        placeholder="ДД.ММ.ГГГГ"
                      />
                      <Text style={s.dateHint}>{isCustomer ? 'До (необяз.)' : 'Финиш'}</Text>
                    </View>
                  </View>
                  {dateError ? <Text style={s.dateErr} accessibilityRole="alert">{dateError}</Text> : null}
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
          </View>
    </SheetSurface>
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
  dateErr: { fontSize: 12, color: RenovaTheme.colors.danger },
  dateHint: { fontSize: 11, color: RenovaTheme.colors.textSubtle },
  metaHint: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  link: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary, marginTop: 4 },
  calcWrap: { gap: 8 },
  calcHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 4 },
  calcWarn: { fontSize: 12, color: '#92400E', backgroundColor: '#FFFBEB', padding: 8, borderRadius: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
});
