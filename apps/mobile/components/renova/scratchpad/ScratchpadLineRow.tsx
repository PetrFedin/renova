/** Строка черновика — tap редактирует, → превращает в задачу/чат/расход */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme, card } from '@/constants/Theme';
import type { ScratchpadLine } from '@/lib/api';
import { isCheckableKind, promotedLabel, scratchpadKindLabel } from '@/lib/domain/scratchpadLine';

type Props = {
  line: ScratchpadLine;
  onToggle: () => void;
  onEdit: () => void;
  onPromote: () => void;
  onDelete: () => void;
  readOnly?: boolean;
};

export function ScratchpadLineRow({ line, onToggle, onEdit, onPromote, onDelete, readOnly }: Props) {
  const checkable = isCheckableKind(line.line_kind);
  const promoted = promotedLabel(line);
  const canPromote = !readOnly && !line.promoted_kind;

  return (
    <View style={[s.row, card, line.done && s.rowDone]}>
      {checkable ? (
        <Pressable onPress={onToggle} style={s.check} accessibilityRole="checkbox" accessibilityState={{ checked: line.done }}>
          <Ionicons name={line.done ? 'checkbox' : 'square-outline'} size={22} color={line.done ? RenovaTheme.colors.accent : RenovaTheme.colors.textMuted} />
        </Pressable>
      ) : (
        <View style={s.dot} />
      )}
      <Pressable style={s.body} onPress={onEdit} onLongPress={onDelete} accessibilityRole="button" accessibilityLabel="Редактировать заметку">
        <Text style={s.kind}>{scratchpadKindLabel(line.line_kind)}</Text>
        <Text style={[s.text, line.done && s.textDone]} numberOfLines={4}>{line.text}</Text>
        {promoted ? <Text style={s.promoted}>{promoted}</Text> : null}
      </Pressable>
      {canPromote ? (
        <Pressable
          style={s.promoteBtn}
          onPress={onPromote}
          accessibilityRole="button"
          accessibilityLabel="Превратить в задачу, чат или расход"
        >
          <Ionicons name="arrow-forward-circle-outline" size={24} color={RenovaTheme.colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8, paddingVertical: 10 },
  rowDone: { opacity: 0.72 },
  check: { paddingTop: 2 },
  dot: { width: 22, height: 22, marginTop: 2, borderRadius: 11, backgroundColor: '#E2E8F0' },
  body: { flex: 1, minWidth: 0 },
  kind: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.accent, textTransform: 'uppercase' },
  text: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text, marginTop: 2, lineHeight: 20 },
  textDone: { textDecorationLine: 'line-through', color: RenovaTheme.colors.textMuted },
  promoted: { fontSize: 11, color: RenovaTheme.colors.primary, marginTop: 4, fontWeight: '600' },
  promoteBtn: { paddingTop: 2, paddingLeft: 2 },
});
