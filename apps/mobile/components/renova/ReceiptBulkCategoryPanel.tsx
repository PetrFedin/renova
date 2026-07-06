/** Массовая категоризация чеков — для отфильтрованного списка на «Бюджет → Расходы» */
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { EXPENSE_CATEGORIES, type ExpenseCategoryId } from '@/constants/expenseCategories';
import { expenseCategoryLabel } from '@/constants/labels';
import { api } from '@/lib/api';

type Props = {
  userId: string;
  projectId: string;
  receiptIds: string[];
  readOnly?: boolean;
  filterLabel?: string;
  onDone: () => void;
};

export function ReceiptBulkCategoryPanel({
  userId, projectId, receiptIds, readOnly, filterLabel, onDone,
}: Props) {
  const [category, setCategory] = useState<ExpenseCategoryId>('materials');
  const [busy, setBusy] = useState(false);

  if (!receiptIds.length || readOnly) return null;

  async function applyCategory() {
    setBusy(true);
    try {
      await Promise.all(
        receiptIds.map((id) => api.patchReceipt(userId, projectId, id, { expense_category: category })),
      );
      Alert.alert('Готово', `Категория «${expenseCategoryLabel(category)}» — ${receiptIds.length} чек(ов)`);
      onDone();
    } catch {
      Alert.alert('Ошибка', 'Не удалось обновить категории. Проверьте сервер.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.box}>
      <Text style={s.head}>
        Категория для {receiptIds.length} чек(ов){filterLabel ? ` · ${filterLabel}` : ''}
      </Text>
      <Text style={s.hint}>Выберите категорию — применится ко всем чекам текущего фильтра</Text>
      <View style={s.catRow}>
        {EXPENSE_CATEGORIES.map((c) => (
          <Pressable
            key={c.id}
            style={[s.catChip, category === c.id && s.catOn]}
            onPress={() => setCategory(c.id)}
          >
            <Text style={[s.catT, category === c.id && s.catTOn]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      <PrimaryButton
        title={busy ? 'Сохранение…' : `Применить «${expenseCategoryLabel(category)}»`}
        variant="outline"
        disabled={busy}
        onPress={applyCategory}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { ...card, marginBottom: 12, paddingVertical: 12 },
  head: { fontWeight: '800', fontSize: 14, marginBottom: 4 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 16 },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  catChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f3f4f6' },
  catOn: { backgroundColor: RenovaTheme.colors.primary },
  catT: { fontSize: 11, fontWeight: '600' },
  catTOn: { color: '#fff' },
});
