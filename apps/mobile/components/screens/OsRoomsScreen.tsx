/** Комнаты объекта — список по этажам (вкладка «Объект → Комнаты») */
import { useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, Pressable, Alert } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { useNavFromHere } from '@/lib/navigation';
import { FloorSectionHeader, groupRoomsByFloor } from '@/components/renova/RoomFloorGroups';
import { StageRoomMatrix } from '@/components/renova/StageRoomMatrix';
import { filterRoomsByArchive } from '@/lib/domain/stageRoomMatrix';
import { SearchFilter } from '@/components/renova/SearchFilter';
import { CreateRoomSheet } from '@/components/renova/CreateRoomSheet';
import { ObjectTabGuide } from '@/components/screens/object/ObjectTabGuide';
import { api, Room, RoomChangeRequest, isRateLimitError } from '@/lib/api';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { roomTypeLabel } from '@/constants/roomTypes';
import { roomChangeStatusLabel } from '@/constants/labels';
import { ROOM_FORM_HINTS } from '@/constants/roomFormHints';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { budgetTabRoute, objectTabHref, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { screenLayout } from '@/constants/screenLayout';

const ROOM_FILTERS = [
  { key: 'active', label: 'Активные' },
  { key: 'archive', label: 'Архив' },
];

import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';

export function OsRoomsScreen({ role, onNextTab }: { role: OsRole; onNextTab?: (tab: ObjectTabId) => void }) {
  if (role === 'contractor') return <ContractorRoomsBody />;
  return <CustomerRoomsBody onNextTab={onNextTab} />;
}

function CustomerRoomsBody({ onNextTab }: { onNextTab?: (tab: ObjectTabId) => void }) {
  const nav = useNavFromHere();
  const { user, activeProject } = useRenova();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [requests, setRequests] = useState<RoomChangeRequest[]>([]);
  const [query, setQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState('active');

  useEffect(() => {
    if (!user || !activeProject) return;
    api
      .listRooms(user.id, activeProject.id, { archived: roomFilter === 'archive' })
      .then((list) => setRooms(filterRoomsByArchive(list, roomFilter === 'archive')))
      .catch(() => {});
    api.listRoomChangeRequests(user.id, activeProject.id).then(setRequests).catch(() => {});
  }, [user?.id, activeProject?.id, roomFilter]);

  const filtered = rooms
    .filter((r) => !query || r.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (a.floor_level ?? 1) - (b.floor_level ?? 1) || a.name.localeCompare(b.name));

  if (!activeProject || !user) return <ProjectEmptyState role="customer" />;

  return (
    <>
      <ReadOnlyBanner />
      <ScrollView style={styles.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <ObjectTabGuide tab="rooms" onNextTab={onNextTab} />
        {!activeProject.contractor_id && (
          <InfoBanner
            tone="info"
            title="Исполнитель не подключён"
            message="Пока подрядчика нет — вы можете редактировать комнаты сами. После подключения изменения только через запрос."
          />
        )}
        {!activeProject.contractor_id ? (
          <PrimaryButton
            title="→ Подключить исполнителя"
            variant="outline"
           
            onPress={() => pushOsNav(objectTabHref('customer', 'profile'), nav.from)}
          />
        ) : (
          <PrimaryButton
            title="→ Ход работ и этапы"
            variant="outline"
           
            onPress={() => pushOsNav(repairTabRoute('customer', 'works'), nav.from)}
          />
        )}
        <SearchFilter query={query} onQuery={setQuery} filters={ROOM_FILTERS} active={roomFilter} onFilter={setRoomFilter} />
        <Text style={styles.hint}>
          {activeProject.contractor_id
            ? 'Нажмите комнату — расходы и запрос изменений исполнителю.'
            : 'Нажмите комнату — можно редактировать параметры до подключения исполнителя.'}
        </Text>
        {!filtered.length && (
          <Text style={styles.empty}>Комнат пока нет. Список появится после создания объекта.</Text>
        )}
        {groupRoomsByFloor(filtered, activeProject.property_type).map(({ floor, rooms: floorRooms }) => (
          <View key={`f-${floor}`}>
            <FloorSectionHeader floor={floor} count={floorRooms.length} isHouse={activeProject.property_type === 'house'} />
            {floorRooms.map((room) => (
              <Pressable key={room.id} onPress={() => nav.room(room.id)}>
                <RoomRequestCard
                  room={room}
                  requestOnly={!!activeProject.contractor_id}
                  onSubmit={async (message, payload) => {
                  try {
                    await api.createRoomChangeRequest(user.id, activeProject.id, { room_id: room.id, message, payload });
                    setRequests(await api.listRoomChangeRequests(user.id, activeProject.id));
                  } catch (e) {
                    if (isOfflineQueued(e)) notifyOfflineQueued('Запрос на изменение');
                    else if (isRateLimitError(e)) Alert.alert('Подождите', 'Слишком много запросов. Повторите через несколько секунд.');
                  }
                }} />
              </Pressable>
            ))}
          </View>
        ))}
        {requests.length > 0 && <Text style={styles.section}>Мои запросы</Text>}
        {requests.map((r) => (
          <View key={r.id} style={styles.req}><Text>{r.message}</Text><Text style={styles.status}>Статус: {roomChangeStatusLabel(r.status)}</Text></View>
        ))}
      </ScrollView>
    </>
  );
}

function ContractorRoomsBody() {
  const nav = useNavFromHere();
  const canWrite = useWriteAllowed();
  const { user, activeProject, loadProject } = useRenova();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [requests, setRequests] = useState<RoomChangeRequest[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [roomFilter, setRoomFilter] = useState('active');
  const [query, setQuery] = useState('');

  const reloadRequests = async () => {
    if (!user || !activeProject) return;
    try {
      setRequests(await api.listRoomChangeRequests(user.id, activeProject.id));
    } catch (e) {
      if (isRateLimitError(e)) return;
    }
  };

  useEffect(() => {
    if (!user || !activeProject) return;
    api
      .listRooms(user.id, activeProject.id, { archived: roomFilter === 'archive' })
      .then((list) => setRooms(filterRoomsByArchive(list, roomFilter === 'archive')))
      .catch(() => {});
    void reloadRequests();
  }, [user?.id, activeProject?.id, roomFilter]);

  const reloadRooms = async () => {
    if (!user || !activeProject) return;
    try {
      const list = await api.listRooms(user.id, activeProject.id, { archived: roomFilter === 'archive' });
      setRooms(filterRoomsByArchive(list, roomFilter === 'archive'));
    } catch (e) {
      if (isRateLimitError(e)) {
        Alert.alert('Подождите', 'Слишком много запросов. Повторите через несколько секунд.');
      }
    }
  };

  const activeRooms = (activeProject.rooms || []).filter((r) => !r.is_archived);

  if (!activeProject || !user) return <ProjectEmptyState role="contractor" />;

  const save = async (room: Room, patch: Partial<Room>) => {
    const u = await api.updateRoom(user.id, activeProject.id, room.id, patch);
    setRooms((prev) => prev.map((r) => (r.id === room.id ? u : r)));
    await loadProject(activeProject.id);
  };

  return (
    <>
      <ReadOnlyBanner />
      <ScrollView style={styles.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <StageRoomMatrix
          rooms={activeRooms}
          stages={activeProject.stages || []}
          canEdit={canWrite}
          onToggleLink={async (stageId, roomIds) => {
            try {
              await api.patchStageRooms(user.id, activeProject.id, stageId, roomIds);
              await loadProject(activeProject.id);
            } catch (e) {
              if (isOfflineQueued(e)) notifyOfflineQueued('Привязка комнат');
              else Alert.alert('Ошибка', 'Не удалось обновить привязку');
            }
          }}
        />
        {canWrite && roomFilter === 'active' && (
          <PrimaryButton title="+ Комната" onPress={() => setShowCreate(true)} />
        )}
        <SearchFilter query={query} onQuery={setQuery} filters={ROOM_FILTERS} active={roomFilter} onFilter={setRoomFilter} />
        {requests.filter((r) => r.status === 'pending').map((r) => (
          <View key={r.id} style={styles.reqPending}>
            <Text style={styles.reqTitle}>Запрос заказчика</Text>
            <Text>{r.message}</Text>
            <View style={styles.row}>
              <PrimaryButton disabled={!canWrite} title="Согласовать" onPress={async () => {
                try {
                  await api.approveRoomChange(user.id, activeProject.id, r.id);
                  await syncProjectSideEffects({ user, project: activeProject });
                  await reloadRequests();
                  await loadProject(activeProject.id);
                  await reloadRooms();
                } catch (e) {
                  if (isOfflineQueued(e)) notifyOfflineQueued('Одобрение запроса');
                  else if (isRateLimitError(e)) Alert.alert('Подождите', 'Слишком много запросов. Повторите через несколько секунд.');
                }
              }} />
              <PrimaryButton disabled={!canWrite} title="Отклонить" variant="outline" onPress={async () => {
                try {
                  await api.rejectRoomChange(user.id, activeProject.id, r.id);
                  await reloadRequests();
                } catch (e) {
                  if (isOfflineQueued(e)) notifyOfflineQueued('Отклонение запроса');
                  else if (isRateLimitError(e)) Alert.alert('Подождите', 'Слишком много запросов. Повторите через несколько секунд.');
                }
              }} />
            </View>
          </View>
        ))}
        {groupRoomsByFloor(
          rooms.filter((r) => !query || r.name.toLowerCase().includes(query.toLowerCase())),
          activeProject.property_type,
        ).map(({ floor, rooms: floorRooms }) => (
          <View key={`f-${floor}`}>
            <FloorSectionHeader floor={floor} count={floorRooms.length} isHouse={activeProject.property_type === 'house'} />
            {floorRooms.map((room) => (
              <RoomForm
                key={room.id}
                room={room}
                onSave={save}
                onOpen={() => nav.room(room.id)}
                canWrite={canWrite}
                archived={roomFilter === 'archive'}
                onArchive={async (archived) => {
                  try {
                    await api.updateRoom(user.id, activeProject.id, room.id, { is_archived: archived });
                    await loadProject(activeProject.id);
                    await reloadRooms();
                    if (archived && roomFilter === 'active') {
                      Alert.alert('В архиве', `«${room.name}» скрыта из активных. Смотрите вкладку «Архив».`);
                    }
                  } catch (e: unknown) {
                    if (isOfflineQueued(e)) notifyOfflineQueued(archived ? 'Архивирование' : 'Восстановление');
                    else Alert.alert(
                      'Ошибка',
                      archived ? 'Не удалось отправить комнату в архив' : 'Не удалось восстановить комнату',
                    );
                  }
                }}
              />
            ))}
          </View>
        ))}
      </ScrollView>
      {user && activeProject && (
        <CreateRoomSheet
          visible={showCreate}
          project={activeProject}
          onClose={() => setShowCreate(false)}
          onCreate={async (body) => {
            const created = await api.createRoom(user.id, activeProject.id, body);
            await loadProject(activeProject.id);
            try {
              await reloadRooms();
            } catch {
              // запасной путь: комната уже на сервере, обновляем список локально
              setRooms((prev) =>
                filterRoomsByArchive(
                  prev.some((r) => r.id === created.id) ? prev : [...prev, created],
                  roomFilter === 'archive',
                ),
              );
            }
          }}
        />
      )}
    </>
  );
}

function RoomRequestCard({ room, onSubmit, requestOnly }: { room: Room; onSubmit: (msg: string, payload: Record<string, unknown>) => Promise<void>; requestOnly?: boolean }) {
  const pathname = usePathname();
  const canWrite = useWriteAllowed();
  const [msg, setMsg] = useState('');
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{room.name} ›</Text>
      <Text style={styles.meta}>{roomTypeLabel(room.room_type)}{(room.floor_level ?? 1) > 1 ? ` · ${room.floor_level} эт.` : ''} · {room.floor_sq_m} м² · розетки {room.outlets_count}</Text>
      <Pressable onPress={() => pushOsNav(budgetTabRoute('customer', 'expenses', { roomId: room.id }), pathname)}>
        <Text style={styles.link}>→ Расходы по комнате</Text>
      </Pressable>
      {canWrite && requestOnly && (
        <>
          <TextInput style={styles.input} placeholder="Запрос изменения…" value={msg} onChangeText={setMsg} />
          <PrimaryButton title="Отправить запрос" variant="outline" onPress={() => { if (msg.trim()) onSubmit(msg.trim(), {}); setMsg(''); }} />
        </>
      )}
      {canWrite && !requestOnly && (
        <Text style={styles.meta}>Редактирование — в карточке комнаты</Text>
      )}
    </View>
  );
}

function RoomForm({ room, onSave, onOpen, canWrite, archived, onArchive }: {
  room: Room;
  onSave: (r: Room, p: Partial<Room>) => void;
  onOpen: () => void;
  canWrite: boolean;
  archived?: boolean;
  onArchive?: (archived: boolean) => void;
}) {
  const pathname = usePathname();
  const [outlets, setOutlets] = useState(String(room.outlets_count));
  const [plumbing, setPlumbing] = useState(String(room.plumbing_points));
  const [switches, setSwitches] = useState(String(room.switches_count));
  const [length, setLength] = useState(String(room.length_m));
  const [width, setWidth] = useState(String(room.width_m));

  return (
    <View style={styles.card}>
      <Pressable onPress={onOpen}><Text style={styles.name}>{room.name} →</Text></Pressable>
      <Text style={styles.meta}>Пол {roomTypeLabel(room.room_type)} · {room.floor_sq_m} м² · Стены {room.wall_sq_m} м²</Text>
      <DimRow label="Длина" hint={ROOM_FORM_HINTS.length} value={length} set={setLength} />
      <DimRow label="Ширина" hint={ROOM_FORM_HINTS.width} value={width} set={setWidth} />
      <DimRow label="Розетки" hint={ROOM_FORM_HINTS.outlets} value={outlets} set={setOutlets} />
      <DimRow label="Выключатели" hint={ROOM_FORM_HINTS.switches} value={switches} set={setSwitches} />
      <DimRow label="Сантехника" hint={ROOM_FORM_HINTS.plumbing} value={plumbing} set={setPlumbing} />
      <PrimaryButton title="Карточка комнаты" variant="outline" onPress={onOpen} />
      <Pressable onPress={() => pushOsNav(budgetTabRoute('contractor', 'expenses', { roomId: room.id }), pathname)}>
        <Text style={styles.link}>→ Расходы по комнате</Text>
      </Pressable>
      <PrimaryButton disabled={!canWrite} title="Сохранить и пересчитать смету" onPress={() => onSave(room, { length_m: +length, width_m: +width, outlets_count: +outlets, switches_count: +switches, plumbing_points: +plumbing })} />
      {canWrite && onArchive && (
        <PrimaryButton
          title={archived ? 'Восстановить из архива' : 'В архив'}
          variant="outline"
          onPress={() => onArchive(!archived)}
        />
      )}
    </View>
  );
}

function DimRow({ label, hint, value, set }: { label: string; hint?: string; value: string; set: (v: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={value} onChangeText={set} />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: RenovaTheme.colors.textMuted, marginBottom: 12, fontSize: 13, lineHeight: 18 },
  empty: { color: RenovaTheme.colors.textMuted, marginBottom: 16, fontSize: 13, fontStyle: 'italic' },
  card: { ...card, paddingVertical: 14 },
  name: { fontWeight: '700', fontSize: 16 },
  meta: { color: RenovaTheme.colors.textMuted, marginTop: 4, fontSize: 13 },
  input: { backgroundColor: '#f9f9f9', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  section: { fontWeight: '700', marginTop: 16, marginBottom: 8 },
  req: { backgroundColor: RenovaTheme.colors.surface, padding: 10, borderRadius: 8, marginBottom: 6 },
  reqPending: { backgroundColor: '#FEF3C7', padding: 12, borderRadius: 10, marginBottom: 12 },
  reqTitle: { fontWeight: '700', marginBottom: 4 },
  row: { gap: 8, marginTop: 10 },
  status: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  field: { marginTop: 8 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.text },
  fieldHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 14 },
  link: { fontSize: 13, color: RenovaTheme.colors.primary, fontWeight: '700', marginTop: 8 },
});
