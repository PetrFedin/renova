/** Операции вне ядра сметы — вывоз, подбор материалов (сворачиваемый блок) */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { WasteOrderList } from '@/components/renova/WasteOrderList';
import { MaterialPickList } from '@/components/renova/MaterialPickList';
import type { Room, Stage } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';

type Props = {
  userId: string;
  projectId: string;
  role: OsRole;
  rooms: Room[];
  stages: Stage[];
};

export function EstimateOperationsPanel({ userId, projectId, role, rooms, stages }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View style={s.wrap}>
      <Pressable style={s.toggle} onPress={() => setOpen((v) => !v)}>
        <Text style={s.toggleT}>Подбор материалов и вывоз {open ? '▾' : '▸'}</Text>
        <Text style={s.hint}>Отдельно от строк сметы · подрядчик добавляет, заказчик согласует</Text>
      </Pressable>
      {open && (
        <View style={s.body}>
          <WasteOrderList userId={userId} projectId={projectId} role={role} />
          <MaterialPickList userId={userId} projectId={projectId} role={role} rooms={rooms} stages={stages} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12 },
  toggle: { ...card, paddingVertical: 12 },
  toggleT: { fontWeight: '700', fontSize: 14, color: RenovaTheme.colors.text },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 16 },
  body: { marginTop: 8 },
});
