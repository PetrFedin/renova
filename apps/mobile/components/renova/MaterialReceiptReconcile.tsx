/** Сверка: закупки по смете vs отсканированные чеки */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import type { Room, ReceiptItem, MaterialPick } from '@/lib/api';
import { roomMaterialTotal, roomReceiptTotal } from '@/lib/expenseSummary';
import { pushRoomDetail } from '@/lib/navigation';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { pushOsNav } from '@/lib/pushOsNav';
import { useRenova } from '@/lib/context/RenovaContext';
import type { OsRole } from '@/constants/osSections';

export function MaterialReceiptReconcile({ rooms, receipts, picks }: {
  rooms: Room[]; receipts: ReceiptItem[]; picks: MaterialPick[];
}) {
  const pathname = usePathname();
  const { user } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const rows = rooms.map((room) => {
    const materials = roomMaterialTotal(picks, room.id);
    const recs = roomReceiptTotal(receipts, room.id);
    return { room, materials, recs, delta: recs - materials };
  }).filter((x) => x.materials > 0 || x.recs > 0);
  if (!rows.length) return null;
  const unmatched = rows.filter((x) => Math.abs(x.delta) > 100);
  return (
    <View style={s.box}>
      <Text style={s.head}>Сверка материалов и чеков</Text>
      <Text style={s.hint}>Закупки по смете и сумма чеков по комнате</Text>
      {rows.map(({ room, materials, recs, delta }) => (
        <Pressable key={room.id} style={s.row} onPress={() => pushRoomDetail(room.id, pathname)}>
          <Text style={s.name}>{room.name}</Text>
          <Text style={s.val}>закупки {formatRub(materials)} · чеки {formatRub(recs)}</Text>
          {Math.abs(delta) > 100 && (
            <Text style={[s.delta, delta > 0 ? s.over : s.under]}>
              {delta > 0 ? `+${formatRub(delta)} без закупки` : `${formatRub(-delta)} не подтверждено чеком`}
            </Text>
          )}
        </Pressable>
      ))}
      {unmatched.length === 0 && rows.length > 0 && <Text style={s.ok}>✓ Сверка в норме</Text>}
      {/* W129: явный CTA скана вместо только FAB-подсказки */}
      <PrimaryButton
        title="Сканировать чек"
        variant="outline"
        compact
        onPress={() => pushOsNav('/scan-receipt', pathname, role)}
      />
    </View>
  );
}
const s = StyleSheet.create({
  box: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 12, padding: 14, marginBottom: 12 },
  head: { fontWeight: '800', marginBottom: 4 },
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  row: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  name: { fontWeight: '700', fontSize: 13 },
  val: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  delta: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  over: { color: RenovaTheme.colors.warning },
  under: { color: '#0369a1' },
  ok: { fontSize: 12, color: RenovaTheme.colors.success, marginTop: 8, fontWeight: '600', marginBottom: 8 },
});
