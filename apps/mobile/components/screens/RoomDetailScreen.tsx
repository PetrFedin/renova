/** Комната — Digital Twin: паспорт сверху, детали по запросу */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, usePathname } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { RoomDiffTimeline } from '@/components/renova/RoomDiffTimeline';
import { RoomDiagramInteractive } from '@/components/renova/RoomDiagramInteractive';
import { RoomBudgetThreshold } from '@/components/renova/RoomBudgetThreshold';
import { RoomPassport } from '@/components/renova/os/RoomPassport';
import { RoomTypePicker, FloorLevelPicker } from '@/components/renova/RoomTypePicker';
import { roomTypeLabel } from '@/constants/roomTypes';
import { snapshotRoom } from '@/lib/roomDiff';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { budgetTabRoute, objectTabHref } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { roomSpentUnified } from '@/lib/domain/expenseAnalytics';
import { calcRoomMetrics } from '@/lib/roomMetrics';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, type User, Room, RoomSnapshot, ReceiptItem, OsExpense, MaterialPick, Purchase } from '@/lib/api';
import { DOCUMENTS_MENU_HINT } from '@/lib/documentsNav';
import { screenLayout } from '@/constants/screenLayout';
import { reportCatch, reportError } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';

type RoomMutation = 'archive' | 'save' | 'materials';
type RoomLoadState = 'loading' | 'ready' | 'error';

export function RoomDetailScreen() {
  const { id, returnTo, overrun } = useLocalSearchParams<{ id: string; returnTo?: string; overrun?: string }>();
  const pathname = usePathname();
  const { loading, projectResolving, user, activeProject, loadProject, readOnly } = useRenova();
  const canWrite = useWriteAllowed();
  const [showDetails, setShowDetails] = useState(false);
  const [history, setHistory] = useState<{field:string;old:string;new:string;at:string}[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [loadState, setLoadState] = useState<RoomLoadState>('loading');
  const [len, setLen] = useState(''); const [wid, setWid] = useState(''); const [hei, setHei] = useState('3');
  const [outlets, setOutlets] = useState('0'); const [plumbing, setPlumbing] = useState('0'); const [switches, setSwitches] = useState('0');
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [expenses, setExpenses] = useState<OsExpense[]>([]);
  const [picks, setPicks] = useState<MaterialPick[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [overrunLines, setOverrunLines] = useState<{ name: string; over: number }[]>([]);
  const [calcItems, setCalcItems] = useState<{ name: string; qty: number; unit: string; note?: string }[]>([]);
  const [roomSnap, setRoomSnap] = useState<RoomSnapshot | null>(null);
  const [mutation, setMutation] = useState<RoomMutation | null>(null);
  const mutationRef = useRef(false);
  const contextRef = useRef<{ userId: string | null; projectId: string | null }>({ userId: null, projectId: null });
  contextRef.current = { userId: user?.id ?? null, projectId: activeProject?.id ?? null };
  const isContractor = user?.role === 'contractor';
  const ownerCanEdit = !isContractor && !activeProject?.contractor_id && canWrite && !readOnly;
  const role = isContractor ? 'contractor' : 'customer';
  const busy = mutation !== null;
  const preview = useMemo(() => calcRoomMetrics(+len || 0, +wid || 0, +hei || 2.7, room?.openings_sq_m ?? 2), [len, wid, hei, room?.openings_sq_m]);

  const runMutation = useCallback(async <T,>(kind: RoomMutation, task: () => Promise<T>): Promise<T | undefined> => {
    if (mutationRef.current) return undefined;
    mutationRef.current = true;
    setMutation(kind);
    try {
      return await task();
    } finally {
      mutationRef.current = false;
      setMutation(null);
    }
  }, []);

  const load = useCallback(async () => {
    const actor = user;
    const projectId = activeProject?.id;
    if (!actor || !projectId || !id) return;
    setLoadState((current) => current === 'ready' ? current : 'loading');
    try {
      const activeRooms = await api.listRooms(actor.id, projectId, { archived: false });
      let nextRoom = activeRooms.find((candidate) => candidate.id === id) ?? null;
      if (!nextRoom) {
        const archivedRooms = await api.listRooms(actor.id, projectId, { archived: true });
        nextRoom = archivedRooms.find((candidate) => candidate.id === id) ?? null;
      }
      if (contextRef.current.userId !== actor.id || contextRef.current.projectId !== projectId) return;

      setRoom(nextRoom);
      if (!nextRoom) {
        setRoomSnap(null);
        setHistory([]);
        setLoadState('ready');
        return;
      }

      api.roomSnapshot(actor.id, projectId, nextRoom.id).then(setRoomSnap).catch((e) => { reportError('components.screens.RoomDetailScreen.RoomSnap', e); setRoomSnap(null); });
      api.roomChangeLog(actor.id, projectId, nextRoom.id).then(setHistory).catch(reportCatch('components.screens.RoomDetailScreen.1'));
      api.listReceipts(actor.id, projectId).then(setReceipts).catch(reportCatch('components.screens.RoomDetailScreen.2'));
      api.osExpenses(actor.id, projectId).then(setExpenses).catch(reportCatch('components.screens.RoomDetailScreen.3'));
      api.listMaterialPicks(actor.id, projectId).then(setPicks).catch(reportCatch('components.screens.RoomDetailScreen.4'));
      api.listPurchases(actor.id, projectId).then(setPurchases).catch(reportCatch('components.screens.RoomDetailScreen.5'));
      setLen(String(nextRoom.length_m)); setWid(String(nextRoom.width_m)); setHei(String(nextRoom.height_m));
      setOutlets(String(nextRoom.outlets_count)); setPlumbing(String(nextRoom.plumbing_points)); setSwitches(String(nextRoom.switches_count));
      setLoadState('ready');
    } catch (error) {
      if (contextRef.current.userId === actor.id && contextRef.current.projectId === projectId) {
        setLoadState('error');
      }
      throw error;
    }
  }, [user, activeProject?.id, id]);

  useEffect(() => {
    setRoom(null);
    setRoomSnap(null);
    setHistory([]);
    setLoadState('loading');
  }, [activeProject?.id, id]);
  useEffect(() => { if (room) snapshotRoom(room).catch(reportCatch('components.screens.RoomDetailScreen.6')); }, [room?.id, room?.outlets_count]);
  useEffect(() => { if (overrun === '1' && user && activeProject && id) api.budgetRoomLines(user.id, activeProject.id, id).then(setOverrunLines).catch(reportCatch('components.screens.RoomDetailScreen.7')); }, [overrun, id, user?.id, activeProject?.id]);
  useEffect(() => { load().catch(reportCatch('components.screens.RoomDetailScreen.8')); }, [load]);
  useProjectDataReload(load);

  const reconcileCommittedRoomMutation = useCallback(async (actor: User, projectId: string) => {
    const isCurrentContext = () => contextRef.current.userId === actor.id && contextRef.current.projectId === projectId;
    if (!isCurrentContext()) return;

    // loadProject fetches a fresh ProjectDetail before refreshing inbox/home, so
    // a committed room mutation never propagates the stale pre-mutation project.
    try {
      await loadProject(projectId);
    } catch (error) {
      reportError('components.screens.RoomDetailScreen.PostCommitProjectRefresh', error);
    }
    if (!isCurrentContext()) return;
    try {
      await load();
    } catch (error) {
      reportError('components.screens.RoomDetailScreen.PostCommitRoomRefresh', error);
    }
  }, [loadProject, load]);

  const lines = (activeProject?.estimate_lines || []).filter(l => (l.room_id && l.room_id === room?.id) || l.room_name === room?.name);

  const toggleArchive = () => {
    if (!user || !activeProject || !room || !isContractor || mutationRef.current) return;
    const actor = user;
    const projectId = activeProject.id;
    const roomId = room.id;
    const nextArchived = !room.is_archived;
    showActionConfirm({
      title: nextArchived ? 'В архив?' : 'Восстановить комнату?',
      message: nextArchived
        ? `«${room.name}» будет скрыта из активных комнат. Работы, смета, расходы и документы сохранятся и останутся доступны после восстановления.`
        : `«${room.name}» снова появится в активных комнатах.`,
      primaryLabel: nextArchived ? 'В архив' : 'Восстановить',
      primaryDestructive: nextArchived,
      onPrimary: () => {
        void runMutation('archive', async () => {
          try {
            await api.updateRoom(actor.id, projectId, roomId, { is_archived: nextArchived });
          } catch (error: unknown) {
            if (isOfflineQueued(error)) notifyOfflineQueued(nextArchived ? 'Архивирование комнаты' : 'Восстановление комнаты');
            else {
              showActionConfirm({
                title: 'Ошибка',
                message: error instanceof Error ? error.message : 'Не удалось изменить архив',
              });
            }
            return;
          }
          await reconcileCommittedRoomMutation(actor, projectId);
        });
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const save = async (body: object) => {
    if (!user || !activeProject || !room) return;
    const actor = user;
    const projectId = activeProject.id;
    const roomId = room.id;
    await runMutation('save', async () => {
      try {
        await api.updateRoom(actor.id, projectId, roomId, body);
      } catch (error: unknown) {
        if (isOfflineQueued(error)) {
          notifyOfflineQueued('Изменения комнаты');
        } else {
          showActionConfirm({
            title: 'Не удалось сохранить комнату',
            message: error instanceof Error ? error.message : 'Повторите попытку.',
          });
        }
        return;
      }
      await reconcileCommittedRoomMutation(actor, projectId);
    });
  };

  if (loading || projectResolving) {
    return (<><BackHeader title="Комната" returnTo={returnTo} /><View style={s.center}><Text>Загрузка объекта…</Text></View></>);
  }
  if (!user || !activeProject) {
    return <ProjectEmptyState role={role} title="Выберите объект" hint="Комната откроется после выбора объекта." showCreate={false} />;
  }
  if (loadState === 'error') {
    return (
      <>
        <BackHeader title="Комната" returnTo={returnTo} />
        <LoadErrorState title="Не удалось загрузить комнату" onRetry={() => { void load(); }} role={role} showChatCta />
      </>
    );
  }
  if (loadState === 'ready' && !room) {
    return (
      <>
        <BackHeader title="Комната" returnTo={returnTo} />
        <View style={[s.center, s.emptyState]}>
          <Text style={s.h}>Комната не найдена</Text>
          <Text style={s.emptyHint}>Проверили и активные, и архивные комнаты. Возможно, комната удалена или ссылка устарела.</Text>
          <PrimaryButton title="Проверить снова" variant="outline" onPress={() => { void load(); }} />
        </View>
      </>
    );
  }
  if (!room) return (<><BackHeader title="Комната" returnTo={returnTo} /><View style={s.center}><Text>Загрузка комнаты…</Text></View></>);

  const project = activeProject;

  return (
    <>
      <BackHeader title={room.name} subtitle={`${roomTypeLabel(room.room_type)}${room.floor_level && room.floor_level > 1 ? ` · ${room.floor_level} эт.` : ''}${room.is_archived ? ' · Архив' : ''}`} returnTo={returnTo} />
      <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
        {isContractor && canWrite && (
          <PrimaryButton
            title={room.is_archived ? 'Восстановить из архива' : 'В архив'}
            variant={room.is_archived ? 'outline' : 'dangerOutline'}
            compact
            loading={mutation === 'archive'}
            disabled={busy && mutation !== 'archive'}
            onPress={toggleArchive}
          />
        )}
        {roomSnap ? <RoomPassport snap={roomSnap} role={role} /> : (
          <View style={s.metrics}>
            <View style={s.metric}><Text style={s.metricN}>{preview.floor_sq_m} м²</Text><Text style={s.metricL}>Пол</Text></View>
            <View style={s.metric}><Text style={s.metricN}>{preview.wall_sq_m} м²</Text><Text style={s.metricL}>Стены</Text></View>
          </View>
        )}

        <RoomDiagramInteractive room={room} />

        <View style={s.card}>
          <Text style={s.h}>Калькулятор материалов</Text>
          {!calcItems.length && <Text style={s.line}>Плитка, краска, ламинат — по размерам комнаты</Text>}
          {calcItems.map((it) => <Text key={it.name} style={s.line}>{it.name}: {it.qty} {it.unit}{it.note ? ` · ${it.note}` : ''}</Text>)}
          {canWrite && (
            <PrimaryButton
              title="Рассчитать материалы"
              variant="outline"
              compact
              loading={mutation === 'materials'}
              disabled={busy && mutation !== 'materials'}
              onPress={() => {
                void runMutation('materials', async () => {
                  const result = await api.calcRoomMaterials(user.id, project.id, room.id);
                  setCalcItems(result.items);
                });
              }}
            />
          )}
        </View>

        {overrunLines.length > 0 && (
          <View style={s.warn}><Text style={s.warnT}>Перерасход по строкам</Text>
            {overrunLines.map(l => <Text key={l.name} style={s.line}>{l.name}: +{l.over} ₽</Text>)}
          </View>
        )}

        {lines.length > 0 && (() => {
          const plan = lines.reduce((a, l) => a + l.quantity_planned * l.unit_price, 0);
          const spent = roomSpentUnified(
            receipts,
            expenses,
            picks,
            project.rooms || [],
            project.stages || [],
            room.id,
            purchases,
          );
          return (
          <View style={s.card}><Text style={s.h}>Расходы</Text>
            <Text style={s.line}>План {formatRub(plan)} · Факт {formatRub(spent)}</Text>
            {plan > 0 && spent > plan && <Text style={s.over}>Перерасход {formatRub(spent - plan)}</Text>}
            <View style={s.row}>
            <PrimaryButton title="Расходы" variant="outline" compact onPress={() => pushOsNav(budgetTabRoute(role, 'expenses', { roomId: room.id }), pathname)} disabled={busy} />
            <PrimaryButton title="Расходы по комнате" variant="outline" compact onPress={() => pushOsNav(budgetTabRoute(role, 'expenses', { roomId: room.id, view: 'rooms' }), pathname)} disabled={busy} />
          </View>
            <Text style={s.fabHint}>Скан чека — кнопка + внизу экрана (с привязкой к комнате)</Text>
          </View>
        ); })()}

        <Pressable style={s.toggle} disabled={busy} onPress={() => setShowDetails(v => !v)}>
          <Text style={s.toggleT}>{showDetails ? 'Скрыть детали' : 'Детали комнаты и журнал'}</Text>
          <Text style={s.chev}>{showDetails ? '▲' : '▼'}</Text>
        </Pressable>

        {showDetails && (
          <>
            {isContractor && <RoomBudgetThreshold value={room.budget_alert_pct} onChange={v => save({ budget_alert_pct: v })} />}
            {isContractor && (<View style={s.card}><Text style={s.h}>Тип и этаж</Text>
              <RoomTypePicker value={room.room_type} onChange={(room_type) => save({ room_type })} />
              <FloorLevelPicker value={room.floor_level ?? 1} max={project.property_type === 'house' ? 3 : 1} onChange={(floor_level) => save({ floor_level })} />
            </View>)}
            {(isContractor || ownerCanEdit) && (<View style={s.card}><Text style={s.h}>Габариты</Text>
              <Field label="Длина" value={len} onChange={setLen} /><Field label="Ширина" value={wid} onChange={setWid} /><Field label="Высота" value={hei} onChange={setHei} />
              <PrimaryButton disabled={(!canWrite && !ownerCanEdit) || busy} loading={mutation === 'save'} title="Сохранить" compact onPress={() => save({ length_m:+len, width_m:+wid, height_m:+hei })} />
            </View>)}
            <View style={s.card}><Text style={s.h}>Инженерия</Text>
              {(isContractor || ownerCanEdit) ? (<><Field label="Розетки" value={outlets} onChange={setOutlets} /><Field label="Сантехника" value={plumbing} onChange={setPlumbing} />
              <PrimaryButton disabled={(!canWrite && !ownerCanEdit) || busy} loading={mutation === 'save'} title="Сохранить" compact onPress={() => save({ outlets_count:+outlets||0, plumbing_points:+plumbing||0, switches_count:+switches||0 })} /></>)
              : <Text style={s.line}>Розетки {room.outlets_count} · сантехника {room.plumbing_points}. Изменения — через запрос исполнителю.</Text>}
            </View>
            {lines.length > 0 && <View style={s.card}><Text style={s.h}>Смета</Text>
              {lines.map(l => (
                <Pressable
                  key={l.id}
                  disabled={busy}
                  onPress={() => pushOsNav(objectTabHref(role, 'estimate'), pathname)}
                >
                  <Text style={s.line}>{l.name}: {formatRub(l.quantity_planned*l.unit_price)}</Text>
                </Pressable>
              ))}
            </View>}
            {history.length > 0 && <RoomDiffTimeline logs={history} />}
            <View style={s.card}>
              <Text style={s.h}>Экспорт</Text>
              <Text style={s.line}>{DOCUMENTS_MENU_HINT}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}
function Field({ label, value, onChange }: { label:string; value:string; onChange:(v:string)=>void }) {
  return <View style={s.field}><Text style={s.lbl}>{label}</Text><TextInput style={s.input} keyboardType="decimal-pad" value={value} onChangeText={onChange} /></View>;
}
const s = StyleSheet.create({
  wrap:{ flex:1, backgroundColor: RenovaTheme.colors.background }, center:{ flex:1, alignItems:'center', justifyContent:'center' },
  emptyState:{ gap:12, padding:24 }, emptyHint:{ maxWidth:420, textAlign:'center', color:RenovaTheme.colors.textMuted, lineHeight:19 },
  metrics:{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:12 }, metric:{ flex:1, minWidth:'45%', backgroundColor:RenovaTheme.colors.surface, borderWidth:1, borderColor:'#E5E7EB', borderRadius:14, padding:12, alignItems:'center' }, metricN:{ fontSize:18, fontWeight:'800' }, metricL:{ fontSize:11, color: RenovaTheme.colors.textMuted, marginTop:2 },
  card:{ backgroundColor:RenovaTheme.colors.surface, padding:14, borderRadius:12, marginBottom:10 }, h:{ fontWeight:'800', marginBottom:8 },
  field:{ marginBottom:8 }, lbl:{ fontSize:12, color: RenovaTheme.colors.textMuted }, input:{ backgroundColor:'#f9fafb', borderRadius:8, padding:10, marginTop:4, borderWidth:1, borderColor:RenovaTheme.colors.border }, line:{ paddingVertical:6, fontSize:13 },
  warn:{ marginBottom:10, backgroundColor:'#fef2f2', padding:12, borderRadius:10 }, warnT:{ fontWeight:'700', color:'#991b1b', marginBottom:4 },
  over:{ color: RenovaTheme.colors.warning, fontWeight:'700', marginVertical:4 },
  toggle:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:14, marginTop:4 },
  toggleT:{ fontWeight:'700', color: RenovaTheme.colors.textMuted, fontSize:13 },
  chev:{ color: RenovaTheme.colors.textMuted },
  row:{ flexDirection:'row', gap:8, marginTop:8 },
  fabHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, fontStyle: 'italic', marginTop: 6 },
});
