/** Drag розеток на схеме */
import { useEffect, useRef, useState } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { View, Text, Pressable, StyleSheet, PanResponder } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Room } from '@/lib/api';
import { reportCatch, reportError } from '@/lib/reportError';

type Pt = { x: number; y: number };
const OW = 200, OH = 140;
const GRID = 10;

function isPoint(value: unknown): value is Pt {
  if (typeof value !== 'object' || value === null) return false;
  if (!('x' in value) || !('y' in value)) return false;
  return typeof value.x === 'number' && Number.isFinite(value.x)
    && typeof value.y === 'number' && Number.isFinite(value.y);
}

function localPoint(event: unknown): Pt | null {
  if (typeof event !== 'object' || event === null || !('nativeEvent' in event)) return null;
  const nativeEvent = event.nativeEvent;
  if (typeof nativeEvent !== 'object' || nativeEvent === null) return null;
  if (!('locationX' in nativeEvent) || !('locationY' in nativeEvent)) return null;
  const x = nativeEvent.locationX;
  const y = nativeEvent.locationY;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null;
  return { x, y };
}

export function RoomDiagramInteractive({ room }: { room: Room }) {
  const [pts, setPts] = useState<Pt[]>([]);
  const ptsRef = useRef<Pt[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  const key = `renova_outlet_layout_${room.id}`;

  const applyPoints = (next: Pt[]) => {
    ptsRef.current = next;
    setPts(next);
  };

  useEffect(() => {
    let alive = true;
    applyPoints([]);
    setDrag(null);
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!alive || !raw) return;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!Array.isArray(parsed)) return;
          applyPoints(parsed.filter(isPoint));
        } catch (error) {
          reportError('components.renova.RoomDiagramInteractive.parse', error, { roomId: room.id });
          void AsyncStorage.removeItem(key).catch(reportCatch('components.renova.RoomDiagramInteractive.repair'));
        }
      })
      .catch(reportCatch('components.renova.RoomDiagramInteractive.load'));
    return () => { alive = false; };
  }, [key, room.id]);

  const save = async (next: Pt[]) => {
    applyPoints(next);
    await AsyncStorage.setItem(key, JSON.stringify(next));
  };

  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (event: unknown) => {
      const point = localPoint(event);
      if (!point) return;
      const current = ptsRef.current;
      const { x, y } = point;
      const i = current.findIndex((p) => Math.hypot(p.x - x, p.y - y) < 14);
      setDrag(i >= 0 ? i : null);
      if (i < 0 && current.length < (room.outlets_count ?? 24)) {
        void save([...current, { x, y }]).catch(reportCatch('components.renova.RoomDiagramInteractive.add'));
      }
    },
    onPanResponderMove: (event: unknown) => {
      if (drag === null) return;
      const point = localPoint(event);
      if (!point) return;
      const next = [...ptsRef.current];
      next[drag] = {
        x: Math.max(0, Math.min(OW, point.x)),
        y: Math.max(0, Math.min(OH, point.y)),
      };
      applyPoints(next);
    },
    onPanResponderRelease: () => {
      if (drag !== null) {
        const snapped = ptsRef.current.map((p) => ({
          x: Math.round(p.x / GRID) * GRID,
          y: Math.round(p.y / GRID) * GRID,
        }));
        void save(snapped).catch(reportCatch('components.renova.RoomDiagramInteractive.release'));
      }
      setDrag(null);
    },
  });

  return (
    <View style={s.wrap}>
      <Text style={s.head}>Схема · tap/drag розетки ({pts.length}/{room.outlets_count})</Text>
      <View {...pan.panHandlers} style={[s.room, { width: OW, height: OH }]}>
        {Array.from({ length: Math.floor(OH / GRID) + 1 }, (_, gy) => Array.from({ length: Math.floor(OW / GRID) + 1 }, (_, gx) => (
          <View key={`g${gx}-${gy}`} style={[s.gridPt, { left: gx * GRID, top: gy * GRID }]} />
        )))}
        <Text style={[s.dimLbl, { top: 2, left: 4 }]}>{room.length_m}м</Text>
        <Text style={[s.dimLbl, { bottom: 2, right: 4 }]}>{room.width_m}м</Text>
        {pts.map((p, i) => <View key={i} style={[s.dot, drag === i && s.dotActive, { left: p.x - 5, top: p.y - 5 }]} />)}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Сбросить расположение розеток"
        onPress={() => {
          applyPoints([]);
          void AsyncStorage.removeItem(key).catch(reportCatch('components.renova.RoomDiagramInteractive.clear'));
        }}
      >
        <Text style={s.clr}>Сбросить</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 12, padding: 12, marginBottom: 10 },
  head: { fontWeight: '700', marginBottom: 8 },
  room: { borderWidth: 2, borderColor: '#374151', backgroundColor: '#f9fafb' },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#f59e0b' },
  dotActive: { backgroundColor: '#ef4444', transform: [{ scale: 1.3 }] },
  clr: { color: '#2563eb', marginTop: 6, fontSize: 12 },
  gridPt: { position: 'absolute', width: 1, height: 1, backgroundColor: '#d1d5db' },
  dimLbl: { position: 'absolute', fontSize: 9, color: '#6b7280', fontWeight: '600' },
});
