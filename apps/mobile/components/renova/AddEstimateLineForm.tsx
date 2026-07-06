/** Добавление строки в смету — работа или материал */
import { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Pressable, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RoomPickerChips } from '@/components/renova/RoomPickerChips';
import { api, type ProjectDetail } from '@/lib/api';
import { EXPENSE_CATEGORIES } from '@/constants/expenseCategories';
import { WORK_TYPES_FALLBACK, type WorkTypeOption } from '@/constants/workCatalog';

const UNITS = ['pcs', 'm2', 'm', 'kg', 'l', 'компл'];

export function AddEstimateLineForm({
  userId,
  project,
  onSaved,
  collapsed,
}: {
  userId: string;
  project: ProjectDetail;
  onSaved?: () => void;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  const [lineType, setLineType] = useState<'work' | 'material'>('work');
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [category, setCategory] = useState('custom');
  const [notes, setNotes] = useState('');
  const [workTypes, setWorkTypes] = useState<WorkTypeOption[]>(WORK_TYPES_FALLBACK);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listWorkTypes().then(setWorkTypes).catch(() => setWorkTypes(WORK_TYPES_FALLBACK));
  }, []);

  useEffect(() => {
    if (lineType === 'material') setCategory('materials');
    else setCategory('custom');
  }, [lineType]);

  async function submit() {
    const quantity_planned = parseFloat(qty.replace(',', '.'));
    const unit_price = parseFloat(price.replace(',', '.'));
    if (!name.trim()) { Alert.alert('Смета', 'Укажите название'); return; }
    if (!quantity_planned || quantity_planned <= 0) { Alert.alert('Смета', 'Укажите количество'); return; }
    setBusy(true);
    try {
      const room = project.rooms?.find((r) => r.id === roomId);
      await api.addEstimateLine(userId, project.id, {
        line_type: lineType,
        name: name.trim(),
        unit,
        quantity_planned,
        unit_price: unit_price || 0,
        room_id: roomId,
        room_name: room?.name || null,
        category,
        notes: notes.trim() || null,
      });
      setName('');
      setQty('1');
      setPrice('');
      setNotes('');
      setRoomId(null);
      onSaved?.();
      Alert.alert('Добавлено', 'Строка добавлена в смету');
    } catch {
      Alert.alert('Ошибка', 'Не удалось добавить строку');
    } finally {
      setBusy(false);
    }
  }

  if (collapsed && !open) {
    return (
      <PrimaryButton title="+ Строка сметы" variant="outline" onPress={() => setOpen(true)} />
    );
  }

  const categoryOptions = lineType === 'work'
    ? workTypes
    : EXPENSE_CATEGORIES.map((c) => ({ code: c.id, name: c.label, category: c.id }));

  return (
    <View style={s.box}>
      <Pressable onPress={() => collapsed && setOpen(false)}>
        <Text style={s.head}>+ Строка сметы · подрядчик</Text>
      </Pressable>
      <View style={s.typeRow}>
        <PrimaryButton title="Работа" compact variant={lineType === 'work' ? 'primary' : 'outline'} onPress={() => setLineType('work')} />
        <PrimaryButton title="Материал" compact variant={lineType === 'material' ? 'primary' : 'outline'} onPress={() => setLineType('material')} />
      </View>
      <TextInput style={s.inp} value={name} onChangeText={setName} placeholder="Название" />
      <View style={s.row2}>
        <TextInput style={[s.inp, s.half]} value={qty} onChangeText={setQty} placeholder="Кол-во" keyboardType="decimal-pad" />
        <TextInput style={[s.inp, s.half]} value={price} onChangeText={setPrice} placeholder="Цена, ₽" keyboardType="decimal-pad" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.unitRow}>
        {UNITS.map((u) => (
          <Pressable key={u} style={[s.unitChip, unit === u && s.unitOn]} onPress={() => setUnit(u)}>
            <Text style={[s.unitT, unit === u && s.unitTOn]}>{u}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={s.lbl}>Статья</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.unitRow}>
        {categoryOptions.slice(0, 12).map((c) => (
          <Pressable key={c.code} style={[s.unitChip, category === c.code && s.unitOn]} onPress={() => setCategory(c.code)}>
            <Text style={[s.unitT, category === c.code && s.unitTOn]} numberOfLines={1}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {(project.rooms?.length ?? 0) > 0 && (
        <RoomPickerChips rooms={project.rooms!} value={roomId} onChange={setRoomId} optional />
      )}
      <TextInput
        style={[s.inp, s.notes]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Заметка: бренд, артикул, условия…"
        multiline
      />
      <PrimaryButton title={busy ? 'Сохранение…' : 'Добавить в смету'} onPress={submit} disabled={busy} />
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  head: { fontWeight: '800', marginBottom: 8 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  row2: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  unitRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  unitChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: RenovaTheme.colors.border },
  unitOn: { backgroundColor: RenovaTheme.colors.primary },
  unitT: { fontSize: 11, fontWeight: '600', color: '#334155' },
  unitTOn: { color: RenovaTheme.colors.surface },
  lbl: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, marginBottom: 4 },
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.borderLight, borderRadius: 10, padding: 12, marginBottom: 8, fontSize: 15 },
  notes: { minHeight: 56, textAlignVertical: 'top' },
});
