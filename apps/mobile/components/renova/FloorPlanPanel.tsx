import { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, Image, Pressable, StyleSheet, PanResponder, Alert, LayoutChangeEvent, ActivityIndicator, Platform } from 'react-native';
import { usePathname, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { api, FloorPlan } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { uploadMediaBlob } from '@/lib/mediaUpload';
import { pickImageForDocumentUpload } from '@/lib/documentUploadPick';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';
import { FurnitureLayer } from '@/components/renova/FurnitureLayer';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { pushRoomDetail } from '@/lib/navigation';
import { RenovaTheme } from '@/constants/Theme';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
const MAP_H = 180;

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
  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [floor, setFloor] = useState(1);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [punchMode, setPunchMode] = useState(false);
  const [mapW, setMapW] = useState(0);
  const [addingPunch, setAddingPunch] = useState(false);
  const planRef = useRef<FloorPlan | null>(null);
  const load = useCallback(() => {
    api.listFloorPlans(userId, projectId).then(setPlans).catch(() => {});
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
      if (isOfflineQueued(e)) notifyOfflineQueued('Позиция на плане');
    }
  };

  const onMapLayout = (e: LayoutChangeEvent) => setMapW(e.nativeEvent.layout.width);

  const capturePunchPhoto = async (): Promise<string | undefined> => {
    // Камера → иначе галерея (поле без камеры / отказ в permission)
    let uri: string | undefined;
    try {
      const cam = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (!cam.canceled && cam.assets[0]) uri = cam.assets[0].uri;
    } catch { /* fall through */ }
    if (!uri) {
      try {
        const lib = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
        if (!lib.canceled && lib.assets[0]) uri = lib.assets[0].uri;
      } catch {
        return undefined;
      }
    }
    if (!uri) return undefined;
    const blob = await (await fetch(uri)).blob();
    return uploadMediaBlob(userId, blob, blob.type || 'image/jpeg');
  };

  const addPunchAt = async (locationX: number, locationY: number) => {
    if (!plan || !mapW || addingPunch) return;
    const x_pct = Math.min(98, Math.max(2, (locationX / mapW) * 100));
    const y_pct = Math.min(98, Math.max(2, (locationY / MAP_H) * 100));
    setAddingPunch(true);
    try {
      let photo_key: string | undefined;
      try {
        photo_key = await capturePunchPhoto();
      } catch {
        /* punch без фото — допустимо */
      }
      await api.createIssue(userId, projectId, {
        title: 'Замечание на плане',
        severity: 'medium',
        floor_plan_id: plan.id,
        x_pct,
        y_pct,
        ...(photo_key ? { photo_key } : {}),
      });
      await syncProjectSideEffects({
        user: user ?? ({ id: userId } as any),
        project: activeProject ?? ({ id: projectId } as any),
      });
      await load();
      setPunchMode(false);
      router.push('/quality-control' as never);
      Alert.alert(
        'Замечание в QC',
        photo_key
          ? 'Сохранено как issue в Контроле качества (с фото на плане).'
          : 'Сохранено как issue в Контроле качества — дополните описание там.',
      );
    } catch (e) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Замечание на плане');
        setPunchMode(false);
        return;
      }
      Alert.alert('Ошибка', 'Не удалось добавить замечание');
    } finally {
      setAddingPunch(false);
    }
  };

  const uploadPlan = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Доступ', 'Нужен доступ к галерее'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.92 });
    if (res.canceled || !res.assets[0]) return;
    setUploading(true);
    try {
      const asset = res.assets[0];
      const blob = await (await fetch(asset.uri)).blob();
      const key = await uploadMediaBlob(userId, blob, blob.type || 'image/jpeg');
      await api.createFloorPlan(userId, projectId, { name: `Этаж ${floor}`, image_key: key, floor_level: floor });
      await syncProjectSideEffects({
        user: user ?? ({ id: userId } as any),
        project: activeProject ?? ({ id: projectId } as any),
      });
      load();
    } catch {
      Alert.alert('Загрузка', 'Не удалось загрузить план');
    } finally {
      setUploading(false);
    }
  };

  const canPunch = role === 'customer' || role === 'contractor';

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
                <Pressable onPress={() => router.push('/quality-control' as never)}>
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
                onPress={(e) => addPunchAt(e.nativeEvent.locationX, e.nativeEvent.locationY)}
              />
            ) : null}
            {(plan.punch ?? []).map((item) => (
              <Pressable
                key={item.id}
                style={[s.punchPin, { left: `${item.x_pct}%`, top: `${item.y_pct}%`, borderColor: punchTone(item.severity, item.status) }]}
                onPress={() => router.push('/quality-control' as never)}
              >
                <Text style={[s.punchPinT, { color: punchTone(item.severity, item.status) }]}>{item.photo_url ? '▣' : '!'}</Text>
              </Pressable>
            ))}
            {!punchMode && plan.pins.map((p) => {
              const pan = PanResponder.create({
                onStartShouldSetPanResponder: () => role === 'contractor',
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
                    <Text style={s.pinT}>{p.label || '·'}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
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
          <Text style={s.emptyTitle}>План не загружен</Text>
          <Text style={s.emptyHint}>
            1. Загрузите чертёж этажа{'\n'}
            2. Сверьте метки комнат с вкладкой «Комнаты» ({roomsCount} шт.){'\n'}
            3. Включите Punch list — отметьте дефект на плане
          </Text>
          {onOpenRooms ? (
            <Pressable onPress={onOpenRooms}>
              <Text style={s.link}>→ Список комнат</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      {plan && <FurnitureLayer userId={userId} projectId={projectId} planId={plan.id} role={role} />}
      {role === 'contractor' && (
        <PrimaryButton
          title={uploading ? 'Загрузка…' : plan ? 'Заменить план этажа' : '+ Загрузить план этажа'}
          variant="outline"
          disabled={uploading}
          onPress={uploadPlan}
        />
      )}
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
  punchOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 2 },
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
