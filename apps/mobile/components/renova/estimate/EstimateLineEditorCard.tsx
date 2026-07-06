/** Одна строка редактора сметы — свёрнута по умолчанию, заметки при раскрытии */
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import type { EstimateLine } from '@/lib/api';
import { estimateLineSourceLabel } from '@/lib/domain/estimateFilters';

type Props = {
  line: EstimateLine;
  canWrite: boolean;
  onPatch: (lineId: string, body: object) => Promise<void>;
};

export function EstimateLineEditorCard({ line, canWrite, onPatch }: Props) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(line.notes || '');
  const total = line.quantity_planned * line.unit_price;
  const isWork = line.line_type === 'work';

  return (
    <View style={s.card}>
      <Pressable style={s.head} onPress={() => setOpen((v) => !v)}>
        <View style={s.headMain}>
          <Text style={s.type}>{isWork ? 'Работа' : 'Материал'}</Text>
          <Text style={s.name} numberOfLines={open ? 3 : 1}>{line.name}</Text>
          <Text style={s.meta}>
            {line.room_name || 'Общее'} · {estimateLineSourceLabel(line)}
          </Text>
        </View>
        <View style={s.headRight}>
          <Text style={s.sum}>{formatRub(total)}</Text>
          <Text style={s.chevron}>{open ? '▾' : '▸'}</Text>
        </View>
      </Pressable>

      {open && (
        <View style={s.body}>
          {line.calc_detail ? <Text style={s.calc}>{line.calc_detail}</Text> : null}
          <FieldRow label="Кол-во план" value={String(line.quantity_planned)} editable={canWrite}
            onCommit={(v) => onPatch(line.id, { quantity_planned: parseFloat(v) || line.quantity_planned })} />
          <FieldRow label="Цена, ₽" value={String(line.unit_price)} editable={canWrite}
            onCommit={(v) => onPatch(line.id, { unit_price: parseFloat(v) || line.unit_price })} />
          {!isWork && (
            <FieldRow
              label="Факт расход"
              value={String(line.quantity_actual || line.quantity_planned)}
              editable={canWrite}
              onCommit={(v) => onPatch(line.id, { quantity_actual: parseFloat(v) || 0 })}
            />
          )}
          <Text style={s.notesLabel}>Заметка / доп. информация</Text>
          <TextInput
            style={s.notes}
            value={notes}
            onChangeText={setNotes}
            editable={canWrite}
            placeholder="Бренд, артикул, условия, комментарий для бригады…"
            multiline
            onEndEditing={() => {
              if ((line.notes || '') !== notes.trim()) onPatch(line.id, { notes: notes.trim() || null });
            }}
          />
        </View>
      )}
    </View>
  );
}

function FieldRow({
  label,
  value,
  editable,
  onCommit,
}: {
  label: string;
  value: string;
  editable: boolean;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.fieldInput}
        value={local}
        onChangeText={setLocal}
        editable={editable}
        keyboardType="decimal-pad"
        onEndEditing={() => onCommit(local)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    marginBottom: 8,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', padding: 12, gap: 8, alignItems: 'flex-start' },
  headMain: { flex: 1 },
  headRight: { alignItems: 'flex-end', gap: 4 },
  type: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  name: { fontWeight: '700', fontSize: 14, marginTop: 2 },
  meta: { fontSize: 11, color: RenovaTheme.colors.textSubtle, marginTop: 4 },
  sum: { fontWeight: '800', fontSize: 14, color: RenovaTheme.colors.primary },
  chevron: { fontSize: 12, color: RenovaTheme.colors.primary, fontWeight: '700' },
  body: { borderTopWidth: 1, borderTopColor: RenovaTheme.colors.border, padding: 12, gap: 8 },
  calc: { fontSize: 11, color: RenovaTheme.colors.primary, fontStyle: 'italic' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldLabel: { width: 92, fontSize: 12, color: RenovaTheme.colors.textMuted },
  fieldInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    backgroundColor: RenovaTheme.colors.surface,
  },
  notesLabel: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.text, marginTop: 4 },
  notes: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 8,
    padding: 10,
    minHeight: 64,
    fontSize: 13,
    textAlignVertical: 'top',
    backgroundColor: RenovaTheme.colors.surface,
  },
});
