/** Мультивыбор объектов для списка чатов — все / один / несколько */
import { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import {
  CHAT_FILTER_ALL,
  chatProjectFilterLabel,
  type ChatProjectFilter,
} from '@/lib/chatProjectFilter';

type ProjectOption = { id: string; name: string };

type Props = {
  projects: ProjectOption[];
  value: ChatProjectFilter;
  onChange: (next: ChatProjectFilter) => void;
  disabled?: boolean;
};

export function ChatProjectFilterDropdown({ projects, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [draftAll, setDraftAll] = useState(value.projectIds === null);
  const [draftIds, setDraftIds] = useState<Set<string>>(
    () => new Set(value.projectIds ?? projects.map((p) => p.id)),
  );

  useEffect(() => {
    if (!open) return;
    const all = value.projectIds === null;
    setDraftAll(all);
    setDraftIds(new Set(all ? projects.map((p) => p.id) : value.projectIds ?? []));
  }, [open, value, projects]);

  const shown = useMemo(() => chatProjectFilterLabel(value, projects), [value, projects]);

  const toggleAll = () => {
    setDraftAll(true);
    setDraftIds(new Set(projects.map((p) => p.id)));
  };

  const toggleProject = (id: string) => {
    const next = new Set(draftAll ? projects.map((p) => p.id) : draftIds);
    if (next.has(id)) {
      if (next.size <= 1) return;
      next.delete(id);
    } else {
      next.add(id);
    }
    setDraftAll(next.size >= projects.length);
    setDraftIds(next);
  };

  const apply = () => {
    if (draftAll || draftIds.size >= projects.length) {
      onChange(CHAT_FILTER_ALL);
    } else {
      onChange({ projectIds: [...draftIds] });
    }
    setOpen(false);
  };

  if (!projects.length) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Фильтр · Объекты</Text>
      <Text style={s.hint}>Каждый чат привязан к одному объекту. Выберите, чьи диалоги показать.</Text>
      <Pressable
        style={[s.field, disabled && s.fieldDisabled]}
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled, expanded: open }}
      >
        <Text style={s.fieldText} numberOfLines={1}>
          {shown}
        </Text>
        <Ionicons name="chevron-down" size={18} color={RenovaTheme.colors.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.menu} onPress={(e) => e.stopPropagation()}>
            <Text style={s.menuTitle}>Объекты</Text>
            <ScrollView style={s.menuScroll} keyboardShouldPersistTaps="handled">
              {projects.length > 1 ? (
                <Pressable style={[s.option, draftAll && s.optionOn]} onPress={toggleAll}>
                  <Text style={[s.optionText, draftAll && s.optionTextOn]}>Все объекты</Text>
                  {draftAll ? <Ionicons name="checkmark" size={18} color={RenovaTheme.colors.primary} /> : null}
                </Pressable>
              ) : null}
              {projects.map((p) => {
                const checked = draftAll || draftIds.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    style={[s.option, checked && !draftAll && s.optionOn]}
                    onPress={() => toggleProject(p.id)}
                  >
                    <Text style={[s.optionText, checked && !draftAll && s.optionTextOn]} numberOfLines={2}>
                      {p.name}
                    </Text>
                    {checked && !draftAll ? (
                      <Ionicons name="checkmark" size={18} color={RenovaTheme.colors.primary} />
                    ) : draftAll ? (
                      <Ionicons name="checkmark" size={18} color={RenovaTheme.colors.textSubtle} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={s.apply} onPress={apply}>
              <Text style={s.applyText}>Применить</Text>
            </Pressable>
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
  wrap: { marginBottom: 12 },
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
    backgroundColor: '#fff',
    minHeight: 48,
  },
  fieldDisabled: { backgroundColor: '#F1F5F9', opacity: 0.95 },
  fieldText: { flex: 1, fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 24,
  },
  menu: {
    backgroundColor: '#fff',
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
    gap: 8,
  },
  optionOn: { backgroundColor: '#EFF6FF' },
  optionText: { flex: 1, fontSize: 15, fontWeight: '500', color: RenovaTheme.colors.text },
  optionTextOn: { fontWeight: '700', color: RenovaTheme.colors.primary },
  apply: {
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.borderLight,
    backgroundColor: '#EFF6FF',
  },
  applyText: { fontSize: 15, fontWeight: '800', color: RenovaTheme.colors.primary },
  cancel: { paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.textMuted },
});
