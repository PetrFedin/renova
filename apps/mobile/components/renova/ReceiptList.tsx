/** Список чеков — категория, комната, редактирование */
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import type { ReceiptItem } from '@/lib/api';
import { expenseCategoryLabel, EXPENSE_CATEGORIES, type ExpenseCategoryId } from '@/constants/expenseCategories';
import { api } from '@/lib/api';

export function ReceiptList({
  receipts, rooms, stages, userId, projectId, editable, onUpdated, onReceiptPress, totalLabel = 'Чеки',
}: {
  receipts: ReceiptItem[];
  rooms?: { id: string; name: string }[];
  stages?: { id: string; name: string }[];
  userId?: string;
  projectId?: string;
  editable?: boolean;
  onUpdated?: () => void;
  onReceiptPress?: (receipt: ReceiptItem) => void;
  totalLabel?: string;
}) {
  if (receipts.length === 0) return null;
  const sum = receipts.reduce((a, r) => a + r.amount, 0);
  const verified = receipts.filter((r) => r.verified).length;

  const reverify = async (r: ReceiptItem) => {
    if (!userId || !projectId || r.source === 'manual') return;
    try {
      const res = await api.reverifyReceipt(userId, projectId, r.id);
      Alert.alert(res.verified ? 'ФНС: ок' : 'ФНС', res.message || (res.verified ? 'Подтверждён' : 'Не подтверждён'));
      onUpdated?.();
    } catch (e: unknown) {
      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось проверить');
    }
  };



  async function patch(r: ReceiptItem, patch: { expense_category?: ExpenseCategoryId; room_id?: string | null; stage_id?: string | null }) {
    if (!userId || !projectId) return;
    try {
      await api.patchReceipt(userId, projectId, r.id, patch);
      onUpdated?.();
    } catch {
      Alert.alert('Ошибка', 'Не удалось обновить чек');
    }
  }

  return (
    <View style={s.wrap}>
      <Text style={s.section}>{totalLabel} · {receipts.length} · {formatRub(sum)}</Text>
      <Text style={s.meta}>Проверено ФНС: {verified} из {receipts.filter((x) => x.source !== "manual").length || receipts.length}</Text>
      {receipts.map((r) => (
        <Pressable key={r.id} style={s.row} onPress={() => onReceiptPress?.(r)}>
          <View style={{ flex: 1 }}>
            <Text style={s.amount}>{formatRub(r.amount)}{r.source === "manual" ? " · наличные" : ""}</Text>
            <Text style={s.date}>
              {expenseCategoryLabel(r.expense_category)}
              {r.room_id && rooms ? ` · ${rooms.find((x) => x.id === r.room_id)?.name || 'комната'}` : ''}{r.stage_id && stages ? ` · ${stages.find((x) => x.id === r.stage_id)?.name || 'этап'}` : ''}
              {' · '}{r.receipt_at || r.created_at?.slice(0, 10)}
              {r.description && r.source === 'manual' ? ` · ${r.description}` : ''}{r.fn && r.fn !== 'MANUAL' ? ` · ФН ${r.fn.slice(-4)}` : ''}
            </Text>
            {editable && (
              <View style={s.editRow}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <Pressable key={c.id} style={[s.chip, r.expense_category === c.id && s.chipOn]} onPress={() => patch(r, { expense_category: c.id })}>
                    <Text style={[s.chipT, r.expense_category === c.id && s.chipTOn]}>{c.label}</Text>
                  </Pressable>
                ))}
                {rooms?.length ? (
                  <>
                    <Pressable style={[s.chip, !r.room_id && s.chipOn]} onPress={() => patch(r, { room_id: null })}>
                      <Text style={[s.chipT, !r.room_id && s.chipTOn]}>Общее</Text>
                    </Pressable>
                    {rooms.map((rm) => (
                      <Pressable key={rm.id} style={[s.chip, r.room_id === rm.id && s.chipOn]} onPress={() => patch(r, { room_id: rm.id })}>
                        <Text style={[s.chipT, r.room_id === rm.id && s.chipTOn]}>{rm.name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : null}
                {stages?.length ? (
                  <>
                    <Pressable style={[s.chip, !r.stage_id && s.chipOn]} onPress={() => patch(r, { stage_id: null })}>
                      <Text style={[s.chipT, !r.stage_id && s.chipTOn]}>— этап</Text>
                    </Pressable>
                    {stages.map((st) => (
                      <Pressable key={st.id} style={[s.chip, r.stage_id === st.id && s.chipOn]} onPress={() => patch(r, { stage_id: st.id })}>
                        <Text style={[s.chipT, r.stage_id === st.id && s.chipTOn]}>{st.name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : null}
              </View>
            )}
          </View>
          {r.verified || r.source === 'manual' ? (
            <Text style={[s.badge, r.verified ? s.ok : s.pending]}>{r.verified ? '✓ ФНС' : 'Не проверен'}</Text>
          ) : (
            <Pressable onPress={() => reverify(r)} hitSlop={8}>
              <Text style={[s.badge, s.pending]}>Проверить ФНС</Text>
            </Pressable>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 8 },
  section: { fontWeight: '700', fontSize: 16, marginBottom: 4 },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: RenovaTheme.colors.surface, padding: 12, borderRadius: 8, marginBottom: 6 },
  amount: { fontWeight: '600', fontSize: 15 },
  date: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  badge: { fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  ok: { backgroundColor: '#DCFCE7', color: RenovaTheme.colors.success },
  pending: { backgroundColor: '#FEF3C7', color: RenovaTheme.colors.warning },
  editRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: RenovaTheme.colors.border },
  chipOn: { backgroundColor: RenovaTheme.colors.primary },
  chipT: { fontSize: 10, fontWeight: '600', color: '#333' },
  chipTOn: { color: RenovaTheme.colors.surface },
});
