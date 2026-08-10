/** Комнаты объекта — список по этажам (вкладка «Объект → Комнаты») */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, Pressable, Alert } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
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
import { InfoBanner } from '@/components/ui/InfoBanner';
import { budgetTabRoute, customerProfileTabHref, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import {
  alertRoomChangeRequested,
  alertRoomArchived,
} from '@/lib/siteOpsNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { alertApprovalApproved, alertApprovalRejected } from '@/lib/fieldCreateNav';
import type { OsRole } from '@/constants/osSections';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { screenLayout } from '@/constants/screenLayout';
import { reportError } from '@/lib/reportError';

const ROOM_FILTERS = [
  { key: 'active', label: 'Активные' },
  { key: 'archive', label: 'Архив' },
];

type CustomerListResource<T> = {
  key: string;
  status: 'loading' | 'loaded' | 'error';
  data: T;
  hasConfirmed: boolean;
};

import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';

export function OsRoomsScreen({ role, onNextTab }: { role: OsRole; onNextTab?: (tab: ObjectTabId) => void }) {
  if (role === 'contractor') return <ContractorRoomsBody />;
  return <CustomerRoomsBody onNextTab={onNextTab} />;
}

function CustomerRoomsBody({ onNextTab }: { onNextTab?: (tab: ObjectTabId) => void }) {
  const nav = useNavFromHere();
  const { user, activeProject } = useRenova();
  const [roomsResource, setRoomsResource] = useState<CustomerListResource<Room[]>>({
    key: '',
    status: 'loading',
    data: [],
    hasConfirmed: false,
  });
  const [requestsResource, setRequestsResource] = useState<CustomerListResource<RoomChangeRequest[]>>({
    key: '',
    status: 'loading',
    data: [],
    hasConfirmed: false,
  });
  const [query, setQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState('active');

  const userId = user?.id;
  const projectId = activeProject?.id;
  const roomsContextKey = `${userId ?? 'signed-out'}:${projectId ?? 'no-project'}:${roomFilter}`;
  const requestsContextKey = `${userId ?? 'signed-out'}:${projectId ?? 'no-project'}`;

  const reloadRooms = useCallback(async () => {
    if (!userId || !projectId) return;
    const roomsKey = `${userId}:${projectId}:${roomFilter}`;
    const requestsKey = `${userId}:${projectId}`;

    setRoomsResource((previous) => previous.key === roomsKey
      ? { ...previous, status: 'loading' }
      : { key: roomsKey, status: 'loading', data: [], hasConfirmed: false });
    setRequestsResource((previous) => previous.key === requestsKey
      ? { ...previous, status: 'loading' }
      : { key: requestsKey, status: 'loading', data: [], hasConfirmed: false });

    const [roomsResult, requestsResult] = await Promise.allSettled([
      api.listRooms(userId, projectId, { archived: roomFilter === 'archive' }),
      api.listRoomChangeRequests(userId, projectId),
    ] as const);

    if (roomsResult.status === 'fulfilled') {
      const nextRooms = filterRoomsByArchive(roomsResult.value, roomFilter === 'archive');
      setRoomsResource((previous) => previous.key === roomsKey
        ? { key: roomsKey, status: 'loaded', data: nextRooms, hasConfirmed: true }
        : previous);
    } else {
      reportError('rooms.customer.listRooms', roomsResult.reason, { userId, projectId, roomFilter });
      setRoomsResource((previous) => previous.key === roomsKey
        ? { ...previous, status: 'error' }
        : previous);
    }

    if (requestsResult.status === 'fulfilled') {
      setRequestsResource((previous) => previous.key === requestsKey
        ? { key: requestsKey, status: 'loaded', data: requestsResult.value, hasConfirmed: true }
        : previous);
    } else {
      reportError('rooms.customer.listRoomChangeRequests', requestsResult.reason, { userId, projectId });
      setRequestsResource((previous) => previous.key === requestsKey
        ? { ...previous, status: 'error' }
        : previous);
    }
  }, [userId, projectId, roomFilter]);

  useEffect(() => {
    void reloadRooms();
  }, [reloadRooms]);
  useProjectDataReload(reloadRooms);

  const roomsState = roomsResource.key === roomsContextKey
    ? roomsResource
    : { key: roomsContextKey, status: 'loading' as const, data: [] as Room[], hasConfirmed: false };
  const requestsState = requestsResource.key === requestsContextKey
    ? requestsResource
    : { key: requestsContextKey, status: 'loading' as const, data: [] as RoomChangeRequest[], hasConfirmed: false };

  const filtered = roomsState.data
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
            onPress={() =>
              pushOsNav(customerProfileTabHref('customer', 'contractor'), nav.from, 'customer')
            }
          />
        ) : (
          <PrimaryButton
            title="→ Ход работ и этапы"
            variant="outline"
            onPress={() => pushOsNav(repairTabRoute('customer', 'works'), nav.from, 'customer')}
          />
        )}
        <SearchFilter query={query} onQuery={setQuery} filters={ROOM_FILTERS} active={roomFilter} onFilter={setRoomFilter} />
        <Text style={styles.hint}>
          {activeProject.contractor_id
            ? 'Откройте комнату для паспорта, расходов и запроса изменений.'
            : 'Откройте комнату для паспорта, размеров и связанных данных.'}
        </Text>
        {roomsState.status === 'error' ? (
          <>
            <InfoBanner
              tone="warning"
              title="Не удалось обновить комнаты"
              message={roomsState.hasConfirmed
                ? 'Показан последний подтверждённый список для этого объекта и фильтра.'
                : 'Актуальный список не получен. Пустой экран не означает, что комнат нет.'}
            />
            <PrimaryButton title="Повторить загрузку" variant="outline" onPress={() => { void reloadRooms(); }} />
          </>
        ) : null}
        {roomsState.status === 'loading' && !roomsState.hasConfirmed ? (
          <Text style={styles.loading}>Загружаем комнаты…</Text>
        ) : null}
        {roomsState.status === 'loaded' && !filtered.length ? (
          <Text style={styles.empty}>Комнат пока нет. Список появится после создания объекта.</Text>
        ) : null}
        {groupRoomsByFloor(filtered, activeProject.property_type).map(({ floor, rooms: floorRooms }) => (
          <View key={`f-${floor}`}>
            <FloorSectionHeader floor={floor} count={floorRooms.length} isHouse={activeProject.property_type === 'house'} />
            {floorRooms.map((room) => (
              <RoomRequestCard
                key={room.id}
                room={room}
                requestOnly={!!activeProject.contractor_id}
                onOpen={() => nav.room(room.id)}
                onSubmit={async (message, payload) => {
                  try {
                    await api.createRoomChangeRequest(user.id, activeProject.id, { room_id: room.id, message, payload });
                    alertRoomChangeRequested('customer');
                    await reloadRooms();
                    return true;
                  } catch (e) {
                    if (isOfflineQueued(e)) notifyOfflineQueued('Запрос на изменение');
                    else if (isRateLimitError(e)) {
                      showActionConfirm({
                        title: 'Подождите',
                        message: 'Слишком много запросов. Повторите через несколько секунд.',
                      });
                    } else {
                      showActionConfirm({
                        title: 'Не удалось отправить',
                        message: 'Запрос сохранён в форме. Повторите отправку позже.',
                      });
                    }
                    return false;
                  }
                }}
              />
            ))}
          </View>
        ))}
        {requestsState.status === 'error' ? (
          <InfoBanner
            tone="warning"
            title="Запросы могут быть неактуальны"
            message={requestsState.hasConfirmed
              ? 'Показаны последние подтверждённые запросы. Повторная загрузка обновит статусы.'
              : 'Не удалось получить список запросов к комнатам.'}
          />
        ) : null}
        {requestsState.data.length > 0 && <Text style={styles.section}>Мои запросы</Text>}
        {requestsState.data.map((r) => (
          <View key={r.id} style={styles.req}>
            <Text>{r.message}</Text>
            <Text style={styles.status}>Статус: {roomChangeStatusLabel(r.status)}</Text>
          </View>
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
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const mutationRef = useRef(false);
  const busy = mutationKey !== null;

  const runMutation = useCallback(async (key: string, task: () => Promise<void>) => {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setMutationKey(key);
    try {
      await task();
    } finally {
      mutationRef.current = false;
      setMutationKey(null);
    }
  }, []);

  const reloadRequests = useCallback(async () => {
    if (!user || !activeProject) return;
    try {
      setRequests(await api.listRoomChangeRequests(user.id, activeProject.id));
    } catch (e) {
      reportError('rooms.contractor.listRoomChangeRequests', e, { userId: user.id, projectId: activeProject.id });
      if (isRateLimitError(e)) return;
    }
  }, [user?.id, activeProject?.id]);

  const reloadRooms = useCallback(async () => {
    if (!user || !activeProject) return;
    try {
      const list = await api.listRooms(user.id, activeProject.id, { archived: roomFilter === 'archive' });
      setRooms(filterRoomsByArchive(list, roomFilter === 'archive'));
    } catch (e) {
      reportError('rooms.contractor.listRooms', e, { userId: user.id, projectId: activeProject.id, roomFilter });
      if (isRateLimitError(e)) {
        showActionConfirm({
          title: 'Подождите',
          message: 'Слишком много запросов. Повторите через несколько секунд.',
        });
      }
    }
  }, [user?.id, activeProject?.id, roomFilter]);

  const refreshRoomsSurface = useCallback(() => {
    void reloadRooms();
    void reloadRequests();
  }, [reloadRooms, reloadRequests]);

  useEffect(() => {
    refreshRoomsSurface();
  }, [refreshRoomsSurface]);
  useProjectDataReload(refreshRoomsSurface);

  if (!activeProject || !user) return <ProjectEmptyState role="contractor" />;

  const activeRooms = (activeProject.rooms || []).filter((r) => !r.is_archived);

  const approveRequest = (request: RoomChangeRequest) => {
    if (!canWrite || mutationRef.current) return;
    const key = `approve:${request.id}`;
    showActionConfirm({
      title: 'Согласовать запрос?',
      message: request.message || 'Комната будет изменена по запросу заказчика.',
      primaryLabel: 'Согласовать',
      onPrimary: () => {
        void runMutation(key, async () => {
          try {
            await api.approveRoomChange(user.id, activeProject.id, request.id);
            await syncProjectSideEffects({ user, project: activeProject });
            await reloadRequests();
            await loadProject(activeProject.id);
            await reloadRooms();
            alertApprovalApproved('contractor', 'room_change');
          } catch (e) {
            if (isOfflineQueued(e)) notifyOfflineQueued('Одобрение запроса');
            else if (isRateLimitError(e)) {
              showActionConfirm({ title: 'Подождите', message: 'Слишком много запросов. Повторите через несколько секунд.' });
            } else {
              showActionConfirm({ title: 'Ошибка', message: 'Не удалось согласовать запрос' });
            }
          }
        });
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const rejectRequest = (request: RoomChangeRequest) => {
    if (!canWrite || mutationRef.current) return;
    const key = `reject:${request.id}`;
    showActionConfirm({
      title: 'Отклонить запрос?',
      message: request.message || 'Запрос заказчика на изменение комнаты будет отклонён.',
      primaryLabel: 'Отклонить',
      primaryDestructive: true,
      onPrimary: () => {
        void runMutation(key, async () => {
          try {
            await api.rejectRoomChange(user.id, activeProject.id, request.id);
            await reloadRequests();
            alertApprovalRejected('contractor', 'room_change');
          } catch (e) {
            if (isOfflineQueued(e)) notifyOfflineQueued('Отклонение запроса');
            else if (isRateLimitError(e)) {
              showActionConfirm({ title: 'Подождите', message: 'Слишком много запросов. Повторите через несколько секунд.' });
            } else {
              showActionConfirm({ title: 'Ошибка', message: 'Не удалось отклонить запрос' });
            }
          }
        });
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const changeArchive = (room: Room, archived: boolean) => {
    if (!canWrite || mutationRef.current) return;
    const key = `archive:${room.id}`;
    showActionConfirm({
      title: archived ? 'В архив?' : 'Восстановить комнату?',
      message: archived
        ? `«${room.name}» будет скрыта из активных комнат. Работы, смета, расходы и документы сохранятся.`
        : `«${room.name}» снова появится в активных комнатах.`,
      primaryLabel: archived ? 'В архив' : 'Восстановить',
      primaryDestructive: archived,
      onPrimary: () => {
        void runMutation(key, async () => {
          try {
            await api.updateRoom(user.id, activeProject.id, room.id, { is_archived: archived });
            await syncProjectSideEffects({ user, project: activeProject });
            await loadProject(activeProject.id);
            await reloadRooms();
            if (archived && roomFilter === 'active') alertRoomArchived('contractor', room.name);
          } catch (e: unknown) {
            if (isOfflineQueued(e)) notifyOfflineQueued(archived ? 'Архивирование' : 'Восстановление');
            else {
              showActionConfirm({
                title: 'Ошибка',
                message: archived ? 'Не удалось отправить комнату в архив' : 'Не удалось восстановить комнату',
              });
            }
          }
        });
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  return (
    <>
      <ReadOnlyBanner />
      <ScrollView style={styles.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <StageRoomMatrix
          rooms={activeRooms}
          stages={activeProject.stages || []}
          canEdit={canWrite && !busy}
          onToggleLink={async (stageId, roomIds) => {
            await runMutation(`link:${stageId}`, async () => {
              try {
                await api.patchStageRooms(user.id, activeProject.id, stageId, roomIds);
                await loadProject(activeProject.id);
              } catch (e) {
                if (isOfflineQueued(e)) notifyOfflineQueued('Привязка комнат');
                else showActionConfirm({ title: 'Ошибка', message: 'Не удалось обновить привязку' });
              }
            });
          }}
        />
        {canWrite && roomFilter === 'active' && (
          <PrimaryButton title="+ Комната" onPress={() => setShowCreate(true)} disabled={busy} />
        )}
        <SearchFilter query={query} onQuery={setQuery} filters={ROOM_FILTERS} active={roomFilter} onFilter={setRoomFilter} />
        {requests.filter((r) => r.status === 'pending').map((r) => (
          <View key={r.id} style={styles.reqPending}>
            <Text style={styles.reqTitle}>Запрос заказчика</Text>
            <Text>{r.message}</Text>
            <View style={styles.row}>
              <PrimaryButton
                disabled={!canWrite || busy}
                loading={mutationKey === `approve:${r.id}`}
                title="Согласовать"
                onPress={() => approveRequest(r)}
              />
              <PrimaryButton
                disabled={!canWrite || busy}
                loading={mutationKey === `reject:${r.id}`}
                title="Отклонить"
                variant="dangerOutline"
                onPress={() => rejectRequest(r)}
              />
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
              <RoomListRow
                key={room.id}
                room={room}
                archived={roomFilter === 'archive'}
                busy={busy}
                archiveLoading={mutationKey === `archive:${room.id}`}
                onOpen={() => nav.room(room.id)}
                onArchive={(archived) => changeArchive(room, archived)}
              />
            ))}
          </View>
        ))}
      </ScrollView>
      {user && activeProject && (
        <CreateRoomSheet
          visible={showCreate}
          project={activeProject}
          onClose={() => { if (!busy) setShowCreate(false); }}
          onCreate={async (body) => {
            const created = await api.createRoom(user.id, activeProject.id, body);
            await loadProject(activeProject.id);
            try {
              await reloadRooms();
            } catch {
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

function RoomRequestCard({
  room,
  onOpen,
  onSubmit,
  requestOnly,
}: {
  room: Room;
  onOpen: () => void;
  onSubmit: (msg: string, payload: Record<string, unknown>) => Promise<boolean>;
  requestOnly?: boolean;
}) {
  const pathname = usePathname();
  const canWrite = useWriteAllowed();
  const [msg, setMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const submit = async () => {
    const message = msg.trim();
    if (!message || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const accepted = await onSubmit(message, {});
      if (accepted) setMsg('');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Открыть комнату ${room.name}`} style={styles.roomHead} onPress={onOpen} disabled={submitting}>
        <View style={styles.roomHeadText}>
          <Text style={styles.name}>{room.name}</Text>
          <Text style={styles.meta}>{roomTypeLabel(room.room_type)}{(room.floor_level ?? 1) > 1 ? ` · ${room.floor_level} эт.` : ''} · {room.floor_sq_m} м²</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Открыть расходы комнаты ${room.name}`}
        style={styles.linkRow}
        disabled={submitting}
        onPress={() => pushOsNav(budgetTabRoute('customer', 'expenses', { roomId: room.id }), pathname, 'customer')}
      >
        <Text style={styles.link}>Расходы по комнате →</Text>
      </Pressable>
      {canWrite && requestOnly && (
        <View style={styles.requestBlock}>
          <TextInput
            style={styles.input}
            placeholder="Запрос изменения…"
            value={msg}
            onChangeText={setMsg}
            editable={!submitting}
          />
          <PrimaryButton
            title="Отправить запрос"
            variant="outline"
            loading={submitting}
            disabled={!msg.trim() || submitting}
            onPress={() => { void submit(); }}
          />
        </View>
      )}
      {canWrite && !requestOnly && (
        <Text style={styles.meta}>Редактирование — в карточке комнаты</Text>
      )}
    </View>
  );
}

function RoomListRow({
  room,
  archived,
  busy,
  archiveLoading,
  onOpen,
  onArchive,
}: {
  room: Room;
  archived: boolean;
  busy: boolean;
  archiveLoading: boolean;
  onOpen: () => void;
  onArchive: (archived: boolean) => void;
}) {
  const pathname = usePathname();
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Открыть комнату ${room.name}`} style={styles.roomHead} onPress={onOpen} disabled={busy}>
        <View style={styles.roomHeadText}>
          <Text style={styles.name}>{room.name}</Text>
          <Text style={styles.meta}>
            {roomTypeLabel(room.room_type)} · пол {room.floor_sq_m} м² · стены {room.wall_sq_m} м²
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Открыть расходы комнаты ${room.name}`}
        style={styles.linkRow}
        disabled={busy}
        onPress={() => pushOsNav(budgetTabRoute('contractor', 'expenses', { roomId: room.id }), pathname, 'contractor')}
      >
        <Text style={styles.link}>Расходы по комнате →</Text>
      </Pressable>
      <PrimaryButton
        title={archived ? 'Восстановить из архива' : 'В архив'}
        variant={archived ? 'outline' : 'dangerOutline'}
        compact
        loading={archiveLoading}
        disabled={busy && !archiveLoading}
        onPress={() => onArchive(!archived)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  hint: { color: RenovaTheme.colors.textMuted, marginBottom: 12, fontSize: 13, lineHeight: 18 },
  loading: { ...screenTypography.empty, marginBottom: 16 },
  empty: { ...screenTypography.empty, marginBottom: 16 },
  card: { ...listRowStyles.row, paddingVertical: 14 },
  roomHead: { minHeight: RenovaTheme.minTouch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roomHeadText: { flex: 1, paddingRight: 8 },
  chevron: { fontSize: 22, color: RenovaTheme.colors.textMuted },
  name: { ...screenTypography.listTitle, fontSize: 16 },
  meta: { ...screenTypography.listMeta },
  input: { backgroundColor: '#f9f9f9', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  requestBlock: { gap: 8 },
  section: { ...screenTypography.section, marginTop: 16 },
  req: { ...listRowStyles.row },
  reqPending: { backgroundColor: RenovaTheme.colors.warningBg, padding: 12, borderRadius: 10, marginBottom: 12 },
  reqTitle: { ...screenTypography.listTitle, marginBottom: 4 },
  row: { gap: 8, marginTop: 10 },
  status: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  linkRow: { minHeight: RenovaTheme.minTouch, justifyContent: 'center' },
  link: { ...screenTypography.listLink, marginTop: 0 },
});
