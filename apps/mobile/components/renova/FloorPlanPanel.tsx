import { useEffect, useState, useRef } from 'react';
import { View, Text, Image, Pressable, StyleSheet, PanResponder, Alert } from 'react-native';
import { usePathname } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { api, FloorPlan } from '@/lib/api';
import { uploadMediaBlob } from '@/lib/mediaUpload';
import { FurnitureLayer } from '@/components/renova/FurnitureLayer';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { pushRoomDetail } from '@/lib/navigation';
import { RenovaTheme } from '@/constants/Theme';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';

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
  const pathname = usePathname();
  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [floor, setFloor] = useState(1);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const planRef = useRef<FloorPlan | null>(null);
  const load = () => api.listFloorPlans(userId, projectId).then(setPlans).catch(() => {});
  useEffect(() => { load(); }, [projectId]);
  const levels = [...new Set(plans.map((p) => (p as { floor_level?: number }).floor_level || 1))].sort();
  const plan = plans.find((p) => ((p as { floor_level?: number }).floor_level || 1) === floor) || plans[0];
  planRef.current = plan || null;
  const savePin = async (pinId: string, x: number, y: number) => {
    if (!plan) return;
    await api.moveFloorPin(userId, projectId, plan.id, pinId, x, y);
    load();
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
      load();
    } catch {
      Alert.alert('Загрузка', 'Не удалось загрузить план');
    } finally {
      setUploading(false);
    }
  };

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
        <View style={s.mapWrap}>
          <Image source={{ uri: `${BASE}${plan.image_url}` }} style={s.img} resizeMode="contain" />
          {plan.pins.map((p) => {
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
      ) : (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>План не загружен</Text>
          <Text style={s.emptyHint}>
            1. Загрузите чертёж этажа{'\n'}
            2. Сверьте метки комнат с вкладкой «Комнаты» ({roomsCount} шт.){'\n'}
            3. Нажмите метку — откроется карточка комнаты
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
  mapWrap: { position: 'relative', minHeight: 180 },
  img: { width: '100%', height: 180, backgroundColor: RenovaTheme.colors.surfaceMuted, borderRadius: 8 },
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
  pin: { position: 'absolute' },
  pinT: { backgroundColor: RenovaTheme.colors.primary, color: RenovaTheme.colors.surface, fontSize: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
});
