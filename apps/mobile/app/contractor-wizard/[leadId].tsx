/** Исполнитель: согласованная заявка -> комнаты -> подтверждённый проект. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { replaceOsNav } from '@/lib/pushOsNav';
import { tabsRoute } from '@/constants/osSections';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { Card } from '@/components/ui/Card';
import { RoomTypePicker, FloorLevelPicker } from '@/components/renova/RoomTypePicker';
import { ROOM_PRESETS, resolveRenovationType, type WizardRoomDraft } from '@/constants/roomTypes';
import { calcRoomMetrics, generateTemplateLines, calcEstimateSummary } from '@/lib/calc-engine';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { BackHeader } from '@/components/renova/BackHeader';
import { reportError } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { loadQuotedLead, openConvertedProject, type ConvertedLeadProject } from '@/lib/leadConversionRecovery';

type JobLead = Awaited<ReturnType<typeof api.listJobLeads>>[number];
type LeadLoadState = 'loading' | 'ready' | 'error' | 'unavailable';

function initialRooms(): WizardRoomDraft[] {
  return [{ name: 'Комната', room_type: 'living', floor_level: 1, length_m: 4, width_m: 3, height_m: 2.7, outlets_count: 4, switches_count: 1, plumbing_points: 0 }];
}

export default function ContractorLeadWizard() {
  const { leadId, returnTo } = useLocalSearchParams<{ leadId: string; returnTo?: string }>();
  const { user, activeProject, refreshProjects, loadProject } = useRenova();
  const userId = user?.id;
  const role = user?.role;
  const scopeKey = `${userId ?? ''}:${role ?? ''}:${leadId ?? ''}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [stateScope, setStateScope] = useState(scopeKey);
  const mounted = useRef(true);
  const loadRequest = useRef(0);
  const busyRef = useRef(false);
  const committedProjectRef = useRef<ConvertedLeadProject | null>(null);
  const [createdProject, setCreatedProject] = useState<ConvertedLeadProject | null>(null);
  const [openRequested, setOpenRequested] = useState(false);
  const [lead, setLead] = useState<JobLead | null>(null);
  const [loadState, setLoadState] = useState<LeadLoadState>('loading');
  const [propertyType, setPropertyType] = useState<'apartment' | 'house'>('apartment');
  const [rooms, setRooms] = useState<WizardRoomDraft[]>(initialRooms);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadRequest.current += 1; };
  }, []);

  const loadLead = useCallback(async () => {
    const request = ++loadRequest.current;
    const isCurrent = () => mounted.current && scopeRef.current === scopeKey && loadRequest.current === request;
    setLead(null);
    setLoadState('loading');
    if (!userId || !leadId || role !== 'contractor') {
      setLoadState('unavailable');
      return;
    }
    try {
      // The board sends a quoted lead here. The API default is open, not quoted.
      const found = await loadQuotedLead((status) => api.listJobLeads(userId, status), leadId);
      if (!isCurrent()) return;
      setLead(found);
      setLoadState(found ? 'ready' : 'unavailable');
    } catch (error) {
      reportError('contractorWizard.load', error, { userId, leadId });
      if (isCurrent()) setLoadState('error');
    }
  }, [userId, role, leadId, scopeKey]);

  useEffect(() => {
    committedProjectRef.current = null;
    setCreatedProject(null);
    setOpenRequested(false);
    busyRef.current = false;
    setBusy(false);
    setPropertyType('apartment');
    setRooms(initialRooms());
    setStateScope(scopeKey);
    void loadLead();
    return () => { loadRequest.current += 1; };
  }, [loadLead, scopeKey]);

  useEffect(() => {
    // loadProject can resolve after swallowing a rate-limit error. Navigate only
    // when the current React context confirms the exact created project.
    if (!openRequested || !createdProject || stateScope !== scopeKey || role !== 'contractor'
      || activeProject?.id !== createdProject.project_id) return;
    setOpenRequested(false);
    try {
      replaceOsNav(tabsRoute('contractor', 'index'), undefined, 'contractor');
    } catch (error) {
      reportError('contractorWizard.convert.navigation', error, { userId, projectId: createdProject.project_id });
      showActionConfirm({ title: 'Проект создан', message: 'Объект открыт в данных приложения. Перейдите на главную.' });
    }
  }, [openRequested, createdProject, stateScope, scopeKey, role, activeProject?.id, userId]);

  const total = useMemo(() => {
    if (!lead) return 0;
    let sum = 0;
    rooms.forEach((room, i) => {
      const metrics = calcRoomMetrics({ lengthM: room.length_m, widthM: room.width_m, heightM: room.height_m, openingsSqM: 2 });
      const renovation = resolveRenovationType(lead.renovation_type || 'cosmetic', room.room_type) as Parameters<typeof generateTemplateLines>[0];
      const lines = generateTemplateLines(renovation, `t${i}`, metrics);
      sum += calcEstimateSummary(lines.materials, lines.works).grandTotal;
    });
    return sum;
  }, [lead, rooms]);

  async function onCreate() {
    if (!userId || !leadId || role !== 'contractor' || busyRef.current || stateScope !== scopeKey) return;
    if (!committedProjectRef.current && (!lead || loadState !== 'ready')) return;
    if (!committedProjectRef.current && rooms.some((room) => !room.name.trim())) {
      showActionConfirm({ title: 'Название комнаты', message: 'Укажите название каждой комнаты.' });
      return;
    }
    const isCurrent = () => mounted.current && scopeRef.current === scopeKey;
    busyRef.current = true;
    setBusy(true);
    setOpenRequested(false);
    try {
      let converted = committedProjectRef.current;
      if (!converted) {
        try {
          converted = await api.convertJobLead(userId, leadId, { property_type: propertyType, rooms });
        } catch (error) {
          reportError('contractorWizard.convert.mutation', error, { userId, leadId });
          if (isCurrent()) {
            showActionConfirm({
              title: 'Результат создания не подтверждён',
              message: 'Проверьте соединение и повторите с теми же параметрами либо обновите проекты. Повторный запрос не должен создавать второй объект.',
            });
          }
          return;
        }
        if (!isCurrent()) return;
        // Preserve the authoritative response BEFORE any fallible refresh.
        committedProjectRef.current = converted;
        setCreatedProject(converted);
      }
      const outcome = await openConvertedProject(converted.project_id, {
        refreshProjects, loadProject, isCurrent,
      });
      if (!isCurrent() || outcome.kind === 'cancelled') return;
      if (outcome.refreshFailed) {
        reportError('contractorWizard.convert.refreshProjects', outcome.refreshError, { userId, projectId: converted.project_id });
      }
      if (outcome.kind === 'open_failed') {
        reportError('contractorWizard.convert.loadProject', outcome.openError, { userId, projectId: converted.project_id });
        showActionConfirm({
          title: 'Проект создан',
          message: 'Объект сохранён, но открыть его автоматически не удалось. Нажмите «Открыть созданный проект» — повторное создание не требуется.',
        });
        return;
      }
      setOpenRequested(true);
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  if (!userId || role !== 'contractor') {
    return <View style={s.center}><Text>Мастер доступен авторизованному исполнителю.</Text></View>;
  }
  // Hide old identity-bearing state synchronously until the effect resets it.
  if (stateScope !== scopeKey) {
    return <View style={s.center}><ActivityIndicator /><Text>Загрузка заявки…</Text></View>;
  }
  if (createdProject) {
    return (
      <>
        <BackHeader title="Проект создан" returnTo={returnTo} subtitle={createdProject.name} />
        <View style={s.stateBox}>
          <Text style={s.meta}>Объект сохранён. Не создавайте его повторно при ошибке загрузки.</Text>
          {openRequested && activeProject?.id !== createdProject.project_id ? (
            <Text>Открытие объекта не подтверждено. Повторите загрузку созданного проекта.</Text>
          ) : null}
          <PrimaryButton title="Открыть созданный проект" loading={busy} disabled={busy} onPress={onCreate} />
          <PrimaryButton title="На главную" variant="outline" disabled={busy} onPress={() => replaceOsNav(tabsRoute('contractor', 'index'), undefined, 'contractor')} />
        </View>
      </>
    );
  }
  if (loadState !== 'ready' || !lead) {
    return (
      <>
        <BackHeader title="Новый объект из заявки" returnTo={returnTo} />
        <View style={s.stateBox}>
          {loadState === 'loading' ? <><ActivityIndicator /><Text>Загрузка заявки…</Text></> : null}
          {loadState === 'error' ? <Text>Не удалось загрузить заявку. Это не означает, что её нет.</Text> : null}
          {loadState === 'unavailable' ? <Text>Заявка недоступна для создания проекта. Обновите список заявок или проверьте свои проекты.</Text> : null}
          {loadState !== 'loading' ? (
            <>
              <PrimaryButton title="Повторить загрузку" variant="outline" onPress={() => void loadLead()} />
              <PrimaryButton title="К заявкам" variant="outline" onPress={() => replaceOsNav('/job-leads', undefined, 'contractor')} />
            </>
          ) : null}
        </View>
      </>
    );
  }

  return (
    <>
      <BackHeader title="Новый объект из заявки" returnTo={returnTo} subtitle={lead.title} />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16 }}>
        <View pointerEvents={busy ? 'none' : 'auto'}>
          <Text style={s.meta}>{lead.address || '—'} · {lead.renovation_type} · {lead.area_sqm || '?'} м²</Text>
          <View style={s.row}>
            {(['apartment', 'house'] as const).map((property) => (
              <Pressable key={property} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: propertyType === property, disabled: busy }} style={[s.ptype, propertyType === property && s.ptypeOn]} onPress={() => setPropertyType(property)}>
                <Text style={propertyType === property ? s.ptypeTOn : s.ptypeT}>{property === 'apartment' ? 'Квартира' : 'Дом'}</Text>
              </Pressable>
            ))}
          </View>
          {rooms.map((room, index) => (
            <Card key={index} variant="base" style={s.cardGap}>
              <TextInput accessibilityLabel={`Название комнаты ${index + 1}`} style={s.inp} editable={!busy} maxLength={100} value={room.name} onChangeText={(name: string) => setRooms((current) => current.map((item, i) => i === index ? { ...item, name } : item))} />
              <RoomTypePicker value={room.room_type} onChange={(room_type) => setRooms((current) => current.map((item, i) => i === index ? { ...item, room_type } : item))} />
              {propertyType === 'house' && (
                <FloorLevelPicker value={room.floor_level ?? 1} onChange={(floor_level) => setRooms((current) => current.map((item, i) => i === index ? { ...item, floor_level } : item))} />
              )}
            </Card>
          ))}
          <View style={s.templates}>
            {ROOM_PRESETS.map((template) => (
              <Pressable key={template.name} accessibilityRole="button" accessibilityLabel={`Добавить: ${template.name}`} disabled={busy || rooms.length >= 100} style={s.tpl} onPress={() => setRooms((current) => [...current, { ...template }])}>
                <Text style={s.tplT}>+ {template.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.total}>Оценка: {formatRub(total)}</Text>
        </View>
        <PrimaryButton title="Создать проект" loading={busy} disabled={busy} onPress={onCreate} />
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateBox: { padding: 16, gap: 12, backgroundColor: RenovaTheme.colors.background },
  meta: { color: RenovaTheme.colors.textMuted, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  ptype: { flex: 1, minHeight: 44, padding: 12, borderRadius: 12, backgroundColor: RenovaTheme.colors.border, alignItems: 'center', justifyContent: 'center' },
  ptypeOn: { backgroundColor: RenovaTheme.colors.primary },
  ptypeT: { fontWeight: '700' },
  ptypeTOn: { fontWeight: '700', color: RenovaTheme.colors.surface },
  cardGap: { marginBottom: 12 },
  inp: { minHeight: 44, borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 12, marginBottom: 8 },
  templates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tpl: { minHeight: 44, justifyContent: 'center', backgroundColor: RenovaTheme.colors.infoBg, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  tplT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.accent },
  total: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.primary, marginVertical: 12 },
});
