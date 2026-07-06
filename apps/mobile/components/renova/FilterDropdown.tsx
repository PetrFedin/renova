/** Выпадающий фильтр — поле + modal-список (тип комнаты, этаж) */
import { useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';

export type FilterOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  title: string;
  hint?: string;
  value: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Переопределение текста в закрытом поле */
  displayLabel?: string;
};

export function FilterDropdown<T extends string>({
  title,
  hint,
  value,
  options,
  onChange,
  placeholder = 'Выберите…',
  disabled,
  displayLabel,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const shown = displayLabel ?? selected?.label ?? placeholder;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{title}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      <Pressable
        style={[s.field, disabled && s.fieldDisabled]}
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled, expanded: open }}
      >
        <Text style={[s.fieldText, !selected && !displayLabel && s.placeholderText]} numberOfLines={1}>
          {shown}
        </Text>
        <Ionicons
          name="chevron-down"
          size={18}
          color={disabled ? RenovaTheme.colors.textSubtle : RenovaTheme.colors.textMuted}
        />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.menu} onPress={(e) => e.stopPropagation()}>
            <Text style={s.menuTitle}>{title}</Text>
            <ScrollView style={s.menuScroll} keyboardShouldPersistTaps="handled">
              {options.map((opt) => {
                const active = opt.value === value;
                return (
                  <Pressable
                    key={opt.value}
                    style={[s.option, active && s.optionOn]}
                    onPress={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <Text style={[s.optionText, active && s.optionTextOn]}>{opt.label}</Text>
                    {active ? (
                      <Ionicons name="checkmark" size={18} color={RenovaTheme.colors.primary} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={s.cancel} onPress={() => setOpen(false)}>
              <Text style={s.cancelText}>Закрыть</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 14 },
  title: { fontSize: 13, fontWeight: '800', color: RenovaTheme.colors.text, marginBottom: 4 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 16, marginBottom: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.borderLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: RenovaTheme.colors.surface,
    minHeight: 48,
  },
  fieldDisabled: { backgroundColor: '#F1F5F9', opacity: 0.95 },
  fieldText: { flex: 1, fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text },
  placeholderText: { color: RenovaTheme.colors.textMuted, fontWeight: '500' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 24,
  },
  menu: {
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: 14,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  menuTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  menuScroll: { maxHeight: 360 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.borderLight,
  },
  optionOn: { backgroundColor: RenovaTheme.colors.infoBg },
  optionText: { flex: 1, fontSize: 15, fontWeight: '500', color: RenovaTheme.colors.text },
  optionTextOn: { fontWeight: '700', color: RenovaTheme.colors.primary },
  cancel: { paddingVertical: 14, alignItems: 'center', borderTopWidth: 1, borderTopColor: RenovaTheme.colors.borderLight },
  cancelText: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.textMuted },
});
