import { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, Image, Pressable, StyleSheet, PanResponder, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, usePathname } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { api, FloorPlan } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { uploadMediaBlob } from '@/lib/mediaUpload';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';
import { FurnitureLayer } from '@/components/renova/FurnitureLayer';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { pushRoomDetail } from '@/lib/navigation';
import { RenovaTheme } from '@/constants/Theme';
import { pushOsNav } from '@/lib/pushOsNav';
import { openQcIssue } from '@/lib/qcNav';
import { ActionConfirmSheet } from '@/components/renova/ActionConfirmSheet';
import { tabsRoute, type OsRole } from '@/constants/osSections';
import { reportCatch, reportError } from '@/lib/reportError';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { EmptyActionState } from '@/components/ui/EmptyActionState';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
const MAP_H = 180;

type MapLayoutEvent = { nativeEvent?: { layout?: { width?: number } } };
type MapPressEvent = { nativeEvent?: { locationX?: number; locationY?: number } };
type PunchPhotoIssue = 'picker_unavailable' | 'upload_failed';
type PunchPhotoCapture = { key?: string; photoIssue?: PunchPhotoIssue };

/** W67 #33: punch = ProjectIssue в QC (единый статус). */
function punchTone(severity: string, status: string) {
  if (status === 'closed') return RenovaTheme.colors.textMuted;
  if (severity === 'critical' || severity === 'high') return RenovaTheme.colors.dangerText;
  if (severity === 'medium') return RenovaTheme.colors.warningText;
  return '#2563EB';
}

export function FloorPlanPanel({
  userId,
  projectId,
  role,
  embedded,
  roomsCount = 0,
  onOpenRooms,
}: {
  userId: string;
  projectId: string;
  role: string;
  embedded?: boolean;
  roomsCount?: number;
  onOpenRooms?: () => void;
}) {
  const { user, activeProject } = useRenova();
  const pathname = usePathname();
  const { punch: punchParam } = useLocalSearchParams<{ punch?: string }>();
  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [floor, setFloor] = useState(1);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [punchMode, setPunchMode] = useState(false);
  const [mapW, setMapW] = useState(0);
  const [addingPunch, setAddingPunch] = useState(false);
  const planRef = useRef<FloorPlan | null>(null);
  /** Clarity B: sheet вместо Alert после punch / upload */
  const [punchSheet, setPunchSheet] = useState<{
    issueId?: string;
    hasPhoto: boolean;
    photoIssue?: PunchPhotoIssue;
    syncDegraded: boolean;
  } | null>(null);
  const [uploadSheet, setUploadSheet] = useState<{ syncDegraded: boolean } | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const sideEffectProject = activeProject?.id === projectId ? activeProject : null;

  // Investor P2: deep-link ?punch=1 → сразу режим замечаний на плане
  useEffect(() => {
    if (punchParam === '1' || punchParam === 'true') setPunchMode(true);
  }, [punchParam]);

  const load = useCallback(() => {
    setLoadState('loading');
    api
      .listFloorPlans(userId, projectId)
      .then((list) => {
        setPlans(list);
        setLoadState('loaded');
      })
      .catch((e) => {
        reportCatch('components.renova.FloorPlanPanel.1')(e);
        setLoadState('error');
      });
  }, [userId, projectId]);
  useEffect(() => { load(); }, [load]);
  useProjectDataReload(load);
  const levels = [...new Set(plans.map((p) => (p as { floor_level?: number }).floor_level || 1))].sort();
  const plan = plans.find((p) => ((p as { floor_level?: number }).floor_level || 1) === floor) || plans[0];
  planRef.current = plan || null;
  const punchItems = plan?.punch ?? [];
  const openPunch = punchItems.filter((p) => p.status !== 'closed');

  const savePin = async (pinId: string, x: number, y: number) => {
    if (!plan) return;
    try {
      await api.moveFloorPin(userId, projectId, plan.id, pinId, x, y);
      load();
    } catch (e) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Позиция на плане');
        return;
      }
      reportError('components.renova.FloorPlanPanel.movePin', e, {
        projectId,
        floorPlanId: plan.id,
        pinId,
      });
      Alert.alert('Позиция не сохранена', 'Не удалось сохранить положение метки. Повторите действие.');
    }
  };

  const onMapLayout = (event: MapLayoutEvent) => {
    const width = event.nativeEvent?.layout?.width;
    if (typeof width === 'number') setMapW(width);
  };

  const capturePunchPhoto = async (): Promise<PunchPhotoCapture> => {
    // Камера → иначе галерея (поле без камеры / отказ в permission).
    // Сбой picker наблюдаем, но не превращаем в ложный фатальный сбой QC: фото опционально.
    let uri: string | undefined;
    let pickerFailed = false;
    try {
      const cam = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (!cam.canceled && cam.assets[0]) uri = cam.assets[0].uri;
    } catch (error) {
      pickerFailed = true;
      reportError('components.renova.FloorPlanPanel.cameraPicker', error, {
        projectId,
        floorPlanId: planRef.current?.id ?? null,
      });
    }
    if (!uri) {
      try {
        const lib = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
        if (!lib.canceled && lib.assets[0]) uri = lib.assets[0].uri;
      } catch (error) {
        reportError('components.renova.FloorPlanPanel.libraryPicker', error, {
          projectId,
          floorPlanId: planRef.current?.id ?? null,
        });
        return { photoIssue: 'picker_unavailable' };
      }
    }
    if (!uri) return pickerFailed ? { photoIssue: 'picker_unavailable' } : {};
    const blob = await (await fetch(uri)).blob();
    const key = await uploadMediaBlob(userId, blob, blob.type || 'image/jpeg');
    return { key };
  };

  const addPunchAt = async (locationX: number, locationY: number) => {
    if (!plan || !mapW || addingPunch) return;
    const x_pct = Math.min(98, Math.max(2, (locationX / mapW) * 100));
    const y_pct = Math.min(98, Math.max(2, (locationY / MAP_H) * 100));
    setAddingPunch(true);
    try {
      let photo_key: string | undefined;
      let photoIssue: PunchPhotoIssue | undefined;
      try {
        const photo = await capturePunchPhoto();
        photo_key = photo.key;
        photoIssue = photo.photoIssue;
      } catch (error) {
        photoIssue = 'upload_failed';
        reportError('components.renova.FloorPlanPanel.punchPhotoUpload', error, {
          projectId,
          floorPlanId: plan.id,
        });
      }

      let created: { id?: string } | undefined;
      try {
        created = await api.createIssue(userId, projectId, {
          title: 'Замечание на плане',
          severity: 'medium',
          floor_plan_id: plan.id,
          x_pct,
          y_pct,
          ...(photo_key ? { photo_key } : {}),
        });
      } catch (e) {
        if (isOfflineQueued(e)) {
          notifyOfflineQueued('Замечание на плане');
          setPunchMode(false);
          return;
        }
        reportError('components.renova.FloorPlanPanel.createPunch', e, {
          projectId,
          floorPlanId: plan.id,
        });
        Alert.alert('Ошибка', 'Не удалось добавить замечание');
        return;
      }

      let syncDegraded = false;
      try {
        await syncProjectSideEffects({ user, project: sideEffectProject });
      } catch (error) {
        syncDegraded = true;
        reportError('components.renova.FloorPlanPanel.punchPostCommitSync', error, {
          projectId,
          floorPlanId: plan.id,
          issueId: created?.id ?? null,
        });
      }
      load();
      setPunchMode(false);
      // Создание уже подтверждено сервером; деградация фото/refresh не должна предлагать повторную мутацию.
      setPunchSheet({
        issueId: created?.id,
        hasPhoto: Boolean(photo_key),
        photoIssue,
        syncDegraded,
      });
    } finally {
      setAddingPunch(false);
    }
  };

  const uploadPlan = async () => {
    let selectedAsset: { uri: string } | null = null;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Доступ', 'Нужен доступ к галерее');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.92 });
      if (res.canceled || !res.assets[0]) return;
      selectedAsset = res.assets[0];
    } catch (error) {
      reportError('components.renova.FloorPlanPanel.planPicker', error, { projectId, floor });
      Alert.alert('Загрузка', 'Не удалось открыть галерею. Повторите действие.');
      return;
    }

    setUploading(true);
    try {
      try {
        const blob = await (await fetch(selectedAsset.uri)).blob();
        const key = await uploadMediaBlob(userId, blob, blob.type || 'image/jpeg');
        await api.createFloorPlan(userId, projectId, {
          name: `Этаж ${floor}`,
          image_key: key,
          floor_level: floor,
        });
      } catch (error) {
        reportError('components.renova.FloorPlanPanel.uploadPlan', error, { projectId, floor });
        Alert.alert('Загрузка', 'Не удалось загрузить план');
        return;
      }

      let syncDegraded = false;
      try {
        await syncProjectSideEffects({ user, project: sideEffectProject });
      } catch (error) {
        syncDegraded = true;
        reportError('components.renova.FloorPlanPanel.planPostCommitSync', error, { projectId, floor });
      }
      load();
      // План уже создан. Ошибка refresh/sync не превращается в ложный create failure и не зовёт к дублю.
      setUploadSheet({ syncDegraded });
    } finally {
      setUploading(false);
    }
  };

  const canPunch = role === 'customer' || role === 'contractor';
  const osRole = (role === 'contractor' ? 'contractor' : 'customer') as OsRole;
  const punchSheetMessage = punchSheet?.hasPhoto
    ? 'Фото прикреплено. Откройте в Контроле качества или останьтесь на плане.'
    : punchSheet?.photoIssue === 'upload_failed'
      ? 'Замечание сохранено, но фото не удалось загрузить. Добавьте его в Контроле качества; повторно создавать замечание не нужно.'
      : punchSheet?.photoIssue === 'picker_unavailable'
        ? 'Замечание сохранено без фото: камера или галерея недоступна. Фото можно добавить в Контроле качества.'
        : 'Фото не прикреплено. Можно дополнить замечание в Контроле качества.';
  const punchSheetMessageWithSync = punchSheet?.syncDegraded
    ? `${punchSheetMessage} Связанные данные объекта обновятся при следующей синхронизации.`
    : punchSheetMessage;

  if (loadState === 'error') {
    return (
      <View style={embedded ? s.embedded : s.box}>
        <LoadErrorState
          title="Не удалось загрузить план"
          onRetry={load}
          role={osRole}
          showChatCta={role === 'customer'}
        />
      </View>
    );
  }

  return (
    <View style={embedded ? s.embedded : s.box}>
      {!embedded ? <Text style={s.head}>Планировка</Text> : null}
      {levels.length > 1 ? (
        <View style={s.floors}>
          {levels.map((l) => (
            <Pressable key={l} style={[s.fchip, floor === l && s.fon]} onPress={() => setFloor(l)}>
              <Text style={floor === l ? s.fonT : s.ft}>{l} эт.</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {plan ? (
        <>
          {canPunch ? (
            <>
              <OfflineSyncStatus compact />
              <View style={s.punchBar}>
                <Pressable
                  style={[s.punchToggle, punchMode && s.punchToggleOn]}
                  onPress={() => setPunchMode((v) => !v)}
                >
                  <Text style={[s.punchToggleT, punchMode && s.punchToggleTOn]}>
                    {punchMode ? '● Замечания (QC)' : '○ Замечания на плане'}
                  </Text>
                </Pressable>
                <Text style={s.punchHint}>{openPunch.length} на плане</Text>
                <Pressable onPress={() => openQcIssue(openPunch[0]?.id, pathname, (role === 'contractor' ? 'contractor' : 'customer') as OsRole)}>
                  <Text style={s.link}>Список →</Text>
                </Pressable>
              </View>
            </>
          ) : null}
          <View style={s.mapWrap} onLayout={onMapLayout}>
            <Image source={{ uri: `${BASE}${plan.image_url}` }} style={s.img} resizeMode="contain" />
            {punchMode ? (
              <Pressable
                style={s.punchOverlay}
                disabled={addingPunch}
                onPress={(event: MapPressEvent) => {
                  const locationX = event.nativeEvent?.locationX;
                  const locationY = event.nativeEvent?.locationY;
                  if (typeof locationX === 'number' && typeof locationY === 'number') {
                    void addPunchAt(locationX, locationY);
                  }
                }}
              />
            ) : null}
            {(plan.punch ?? []).map((item) => (
              <Pressable
                key={item.id}
                style={[s.punchPin, { left: `${item.x_pct}%`, top: `${item.y_pct}%`, borderColor: punchTone(item.severity, item.status) }]}
                onPress={() => openQcIssue(item.id, pathname, (role === 'contractor' ? 'contractor' : 'customer') as OsRole)}
              >
                <Text style={[s.punchPinT, { color: punchTone(item.severity, item.status) }]}>{item.photo_url ? '▣' : '!'}</Text>
              </Pressable>
            ))}
            {!punchMode && plan.pins.map((p) => {
              const accepted = Boolean(p.label?.trim().startsWith('✓'));
              const pan = PanResponder.create({
                onStartShouldSetPanResponder: () => role === 'contractor' && !accepted,
                onPanResponderMove: (_, g) =>
                  setDrag({
                    id: p.id,
                    x: Math.min(98, Math.max(2, p.x_pct + g.dx / 2)),
                    y: Math.min(98, Math.max(2, p.y_pct + g.dy / 2)),
                  }),
                onPanResponderRelease: (_, g) => {
                  const nx = Math.min(98, Math.max(2, p.x_pct + g.dx / 2));
                  const ny = Math.min(98, Math.max(2, p.y_pct + g.dy / 2));
                  setDrag(null);
                  savePin(p.id, nx, ny);
                },
              });
              const x = drag?.id === p.id ? drag.x : p.x_pct;
              const y = drag?.id === p.id ? drag.y : p.y_pct;
              return (
                <View key={p.id} {...pan.panHandlers} style={[s.pin, { left: `${x}%`, top: `${y}%` }]}>
                  <Pressable onPress={() => pushRoomDetail(p.room_id, pathname)}>
                    <Text style={[s.pinT, accepted && s.pinAccepted]}>{p.label || '·'}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
          {/* W125: легенда приёмки на плане */}
          {!punchMode && (plan.pins ?? []).some((p) => p.label?.trim().startsWith('✓')) ? (
            <Text style={s.acceptLegend}>✓ на метке комнаты = этап принят</Text>
          ) : null}
          {punchMode ? (
            <View style={s.punchModeRow}>
              {addingPunch ? <ActivityIndicator color={RenovaTheme.colors.primary} /> : null}
              <Text style={s.punchModeHint}>
                {addingPunch ? 'Сохраняем фото и замечание…' : 'Нажмите на план — откроется камера, фото прикрепится к замечанию'}
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <View style={s.emptyBox}>
          <EmptyActionState
            title="План не загружен"
            hint={
              role === 'contractor'
                ? 'Загрузите чертёж этажа, сверьте комнаты, затем отмечайте замечания на плане.'
                : 'Подрядчик ещё не загрузил чертёж. Когда появится — «Замечания на плане» → фото дефекта.'
            }
            actionLabel={
              role === 'contractor'
                ? '+ Загрузить план'
                : 'Написать подрядчику'
            }
            onAction={
              role === 'contractor'
                ? () => { void uploadPlan(); }
                : () => pushOsNav(tabsRoute('customer', 'chat'), pathname, 'customer')
            }
          />
        </View>
      )}
      {plan && <FurnitureLayer userId={userId} projectId={projectId} planId={plan.id} role={role} />}
      {/* Clarity G: upload в empty — primary; outline только для замены */}
      {role === 'contractor' && plan ? (
        <PrimaryButton
          title={uploading ? 'Загрузка…' : 'Заменить план этажа'}
          variant="outline"
          disabled={uploading}
          onPress={uploadPlan}
        />
      ) : null}

      <ActionConfirmSheet
        visible={Boolean(punchSheet)}
        title="Замечание сохранено"
        message={punchSheetMessageWithSync}
        primaryLabel="Открыть в QC"
        onPrimary={() => openQcIssue(punchSheet?.issueId, pathname, osRole)}
        secondaryLabel="Остаться на плане"
        onSecondary={() => undefined}
        onClose={() => setPunchSheet(null)}
      />
      <ActionConfirmSheet
        visible={Boolean(uploadSheet)}
        title="План загружен"
        message={
          uploadSheet?.syncDegraded
            ? 'План сохранён. Связанные данные объекта обновятся при следующей синхронизации; повторно загружать план не нужно.'
            : 'Отметьте замечания на плане или сверьте комнаты.'
        }
        primaryLabel="Замечания на плане"
        onPrimary={() => setPunchMode(true)}
        secondaryLabel={onOpenRooms ? 'Комнаты' : undefined}
        onSecondary={onOpenRooms}
        onClose={() => setUploadSheet(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginVertical: 10, backgroundColor: RenovaTheme.colors.surface, padding: 12, borderRadius: 10 },
  embedded: { gap: 8 },
  head: { fontWeight: '800', marginBottom: 8 },
  floors: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  fchip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: RenovaTheme.colors.border },
  fon: { backgroundColor: RenovaTheme.colors.primary },
  ft: { fontSize: 11 },
  fonT: { fontSize: 11, color: RenovaTheme.colors.surface },
  punchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  punchToggle: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  punchToggleOn: { backgroundColor: '#FEF2F2', borderColor: RenovaTheme.colors.dangerText },
  punchToggleT: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted },
  punchToggleTOn: { color: RenovaTheme.colors.dangerText },
  punchHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, flex: 1 },
  punchModeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  punchModeHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, flex: 1 },
  mapWrap: { position: 'relative', minHeight: MAP_H },
  img: { width: '100%', height: MAP_H, backgroundColor: RenovaTheme.colors.surfaceMuted, borderRadius: 8 },
  punchOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2 },
  emptyBox: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    gap: 6,
  },
  emptyTitle: { fontWeight: '700', fontSize: 14 },
  emptyHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  link: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary, marginTop: 4 },
  pin: { position: 'absolute', zIndex: 1 },
  pinT: { backgroundColor: RenovaTheme.colors.primary, color: RenovaTheme.colors.surface, fontSize: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  /** W125: метка после mark_acceptance_pin_on_plan */
  pinAccepted: { backgroundColor: '#166534', borderWidth: 1, borderColor: '#BBF7D0' },
  acceptLegend: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 6 },
  punchPin: {
    position: 'absolute',
    zIndex: 3,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -11,
    marginTop: -11,
  },
  punchPinT: { fontWeight: '900', fontSize: 13, lineHeight: 14 },
});