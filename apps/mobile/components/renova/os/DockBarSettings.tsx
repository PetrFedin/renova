/** Настройка нижней панели — 2 обязательных + 3 из 4 дополнительных */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import {
  DOCK_BY_ID,
  DOCK_CATALOG,
  DOCK_MANDATORY,
  DOCK_MAX,
  DOCK_OPTIONAL,
  DOCK_OPTIONAL_SLOTS,
  type DockItemId,
} from '@/constants/dockBar';
import { getDockBar, setDockBar, toggleDockItem } from '@/lib/dockBarPrefs';
import { TabIcon } from '@/components/renova/TabIcon';
import type { OsRole } from '@/constants/osSections';

function DockPreview({ selected }: { selected: DockItemId[] }) {
  return (
    <View style={s.preview}>
      {selected.map((id) => {
        const item = DOCK_BY_ID[id];
        if (!item) return null;
        return (
          <View key={id} style={s.previewSlot}>
            <TabIcon name={item.icon} color={RenovaTheme.colors.accent} size={16} />
            <Text style={s.previewLabel} numberOfLines={1}>{item.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function DockRow({
  id,
  on,
  locked,
  onPress,
}: {
  id: DockItemId;
  on: boolean;
  locked: boolean;
  onPress: () => void;
}) {
  const item = DOCK_BY_ID[id];
  if (!item) return null;
  return (
    <Pressable
      style={[s.row, card, on && s.rowOn, locked && s.rowLock]}
      onPress={onPress}
      disabled={locked}
    >
      <TabIcon name={item.icon} color={on ? RenovaTheme.colors.accent : RenovaTheme.colors.textMuted} size={20} />
      <View style={s.meta}>
        <Text style={[s.label, on && s.labelOn]}>{item.label}</Text>
        {locked ? <Text style={s.lock}>всегда в панели</Text> : null}
      </View>
      <Text style={[s.check, on && s.checkOn]}>{on ? '✓' : '○'}</Text>
    </Pressable>
  );
}

export function DockBarSettings({ role, embedded }: { role: OsRole; embedded?: boolean }) {
  const [selected, setSelected] = useState<DockItemId[]>([]);
  const [expanded, setExpanded] = useState(!embedded);

  useEffect(() => { getDockBar(role).then(setSelected).catch(() => {}); }, [role]);

  const optionalOn = DOCK_OPTIONAL.filter((id) => selected.includes(id));

  const onToggle = async (id: DockItemId) => {
    if (DOCK_MANDATORY.includes(id)) {
      Alert.alert('Обязательно', '«Главная» и «Сообщения» всегда в нижней панели.');
      return;
    }
    try {
      const { ids, replaced } = await toggleDockItem(role, id);
      setSelected(ids);
      if (replaced && ids.includes(id)) {
        Alert.alert(
          'Панель обновлена',
          `«${DOCK_BY_ID[replaced]?.label}» заменён на «${DOCK_BY_ID[id]?.label}».`,
        );
      }
    } catch (e: any) {
      if (e?.message === 'max') {
        Alert.alert('Максимум 5', 'Отключите другой раздел или включите новый — он заменит последний дополнительный.');
      } else if (e?.message === 'min') {
        Alert.alert(
          'Замена раздела',
          `Чтобы убрать «${DOCK_BY_ID[id]?.label}», сначала включите другой раздел — он займёт его место в панели.`,
        );
      }
    }
  };

  const reset = async () => {
    const next = await setDockBar(role, ['home', 'chat', 'object', 'repair', 'budget']);
    setSelected(next);
  };

  return (
    <View style={[s.wrap, embedded && s.embedded]}>
      {!embedded ? (
        <Text style={s.head}>Нижняя панель</Text>
      ) : (
        <Text style={s.subHead}>Нижняя панель</Text>
      )}
      <Text style={s.count}>
        Дополнительно: {optionalOn.length}/{DOCK_OPTIONAL_SLOTS} · всего {selected.length}/{DOCK_MAX}
      </Text>
      {selected.length === DOCK_MAX ? <DockPreview selected={selected} /> : null}

      {embedded && !expanded ? (
        <Pressable onPress={() => setExpanded(true)} style={s.expand}>
          <Text style={s.expandT}>Изменить разделы панели ▼</Text>
        </Pressable>
      ) : null}

      {expanded ? (
        <>
      <Text style={s.group}>Обязательные</Text>
      {DOCK_MANDATORY.map((id) => (
        <DockRow key={id} id={id} on={selected.includes(id)} locked onPress={() => onToggle(id)} />
      ))}

      <Text style={s.group}>Дополнительные — {DOCK_OPTIONAL_SLOTS} из {DOCK_OPTIONAL.length}</Text>
      {DOCK_OPTIONAL.map((id) => (
        <DockRow key={id} id={id} on={selected.includes(id)} locked={false} onPress={() => onToggle(id)} />
      ))}

      <Pressable onPress={reset} style={s.reset}>
        <Text style={s.resetT}>Сбросить по умолчанию</Text>
      </Pressable>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 8 },
  embedded: { marginBottom: 0, marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: RenovaTheme.colors.border },
  head: { fontWeight: '700', fontSize: 15, color: RenovaTheme.colors.text, marginBottom: 4 },
  subHead: { fontWeight: '700', fontSize: 14, color: RenovaTheme.colors.text, marginBottom: 2 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 6 },
  subHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, lineHeight: 16, marginBottom: 6 },
  count: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.accent, marginBottom: 8 },
  expand: { marginBottom: 8, paddingVertical: 4 },
  expandT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.primary },
  group: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8, marginBottom: 6 },
  preview: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 10,
    padding: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  previewSlot: { flex: 1, alignItems: 'center', minWidth: 0 },
  previewLabel: { fontSize: 8, fontWeight: '600', color: RenovaTheme.colors.textMuted, marginTop: 2, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginBottom: 6 },
  rowOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: RenovaTheme.colors.infoBg },
  rowLock: { opacity: 0.92 },
  meta: { flex: 1 },
  label: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text },
  labelOn: { color: RenovaTheme.colors.accent },
  lock: { fontSize: 10, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  check: { fontSize: 16, color: RenovaTheme.colors.textSubtle, fontWeight: '700' },
  checkOn: { color: RenovaTheme.colors.accent },
  reset: { marginTop: 10, alignItems: 'center', padding: 10 },
  resetT: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.primary },
});
