/** Настройка виджетов главной — пресеты и галочки */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import {
  HOME_WIDGET_CATALOG,
  HOME_WIDGET_GROUP_LABEL,
  HOME_WIDGET_DEFAULT,
  HOME_WIDGET_PRESETS,
  type HomeWidgetId,
  type HomeWidgetPresetId,
} from '@/constants/homeWidgets';
import { applyHomeWidgetPreset, getHomeWidgets, toggleHomeWidget, resetHomeWidgets } from '@/lib/homeWidgetPrefs';
import type { OsRole } from '@/constants/osSections';

const GROUPS = ['main', 'kpi', 'lists'] as const;

export function HomeWidgetSettings({ role, embedded }: { role: OsRole; embedded?: boolean }) {
  const [enabled, setEnabled] = useState<Set<HomeWidgetId>>(new Set(HOME_WIDGET_DEFAULT));
  const [activePreset, setActivePreset] = useState<HomeWidgetPresetId | null>('standard');
  const [showBlocks, setShowBlocks] = useState(false);

  useEffect(() => {
    getHomeWidgets(role).then((ids) => {
      setEnabled(new Set(ids));
      const match = (Object.keys(HOME_WIDGET_PRESETS) as HomeWidgetPresetId[]).find((p) => {
        const preset = new Set(HOME_WIDGET_PRESETS[p].ids);
        return ids.length === preset.size && ids.every((id) => preset.has(id));
      });
      setActivePreset(match || null);
    }).catch(() => {});
  }, [role]);

  const onToggle = async (id: HomeWidgetId) => {
    if (enabled.has(id) && enabled.size <= 1) {
      Alert.alert('Минимум один', 'На главной должен остаться хотя бы один виджет.');
      return;
    }
    const next = await toggleHomeWidget(role, id);
    setEnabled(new Set(next));
    setActivePreset(null);
  };

  const onPreset = async (preset: HomeWidgetPresetId) => {
    const next = await applyHomeWidgetPreset(role, preset);
    setEnabled(new Set(next));
    setActivePreset(preset);
    if (preset === 'brief') setShowBlocks(false);
  };

  const reset = async () => {
    const next = await resetHomeWidgets(role);
    setEnabled(new Set(next));
    setActivePreset('brief');
    setShowBlocks(false);
  };

  const showBlockToggles = !embedded || showBlocks || activePreset === 'detailed' || activePreset === null;

  return (
    <View style={[s.wrap, embedded && s.embedded]}>
      {!embedded ? (
        <>
          <Text style={s.head}>Вид главной</Text>
          <Text style={s.hint}>Пресет или отдельные блоки. Главное действие → показатели → «Ещё».</Text>
        </>
      ) : (
        <>
          <Text style={s.subHead}>Вид главной</Text>
          <Text style={s.subHint}>Пресет или отдельные блоки. Главное → показатели → «Ещё».</Text>
        </>
      )}

      <View style={s.presets}>
        {(Object.keys(HOME_WIDGET_PRESETS) as HomeWidgetPresetId[]).map((id) => {
          const p = HOME_WIDGET_PRESETS[id];
          const on = activePreset === id;
          return (
            <Pressable key={id} style={[s.preset, on && s.presetOn]} onPress={() => onPreset(id)}>
              <Text style={[s.presetT, on && s.presetTOn]}>{p.label}</Text>
              <Text style={s.presetH}>{p.hint}</Text>
            </Pressable>
          );
        })}
      </View>

      {embedded && !showBlockToggles ? (
        <Pressable onPress={() => setShowBlocks(true)} style={s.expand}>
          <Text style={s.expandT}>Настроить блоки по отдельности ▼</Text>
        </Pressable>
      ) : null}

      {showBlockToggles ? GROUPS.map((group) => {
        const items = HOME_WIDGET_CATALOG.filter((w) => w.group === group && !w.hidden);
        if (!items.length) return null;
        return (
          <View key={group}>
            <Text style={s.group}>{HOME_WIDGET_GROUP_LABEL[group]}</Text>
            {items.map((item) => {
              const on = enabled.has(item.id);
              return (
                <Pressable key={item.id} style={[s.row, card, on && s.rowOn]} onPress={() => onToggle(item.id)}>
                  <View style={s.meta}>
                    <Text style={[s.label, on && s.labelOn]}>{item.label}</Text>
                    {item.hint ? <Text style={s.sub}>{item.hint}</Text> : null}
                  </View>
                  <Text style={[s.check, on && s.checkOn]}>{on ? '✓' : '○'}</Text>
                </Pressable>
              );
            })}
          </View>
        );
      }) : null}
      {showBlockToggles ? (
      <Pressable onPress={reset} style={s.reset}>
        <Text style={s.resetT}>Сбросить к «Кратко»</Text>
      </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12 },
  embedded: { marginBottom: 0 },
  head: { fontWeight: '700', fontSize: 15, color: RenovaTheme.colors.text, marginBottom: 4 },
  subHead: { fontWeight: '700', fontSize: 14, color: RenovaTheme.colors.text, marginBottom: 2 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 8 },
  subHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, lineHeight: 16, marginBottom: 8 },
  presets: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  preset: { flex: 1, ...card, padding: 10, marginBottom: 0 },
  presetOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: RenovaTheme.colors.infoBg },
  presetT: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text },
  presetTOn: { color: RenovaTheme.colors.accent },
  presetH: { fontSize: 10, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  expand: { marginBottom: 8, paddingVertical: 6 },
  expandT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.primary },
  group: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginTop: 8, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, marginBottom: 6 },
  rowOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: RenovaTheme.colors.infoBg },
  meta: { flex: 1 },
  label: { fontSize: 14, fontWeight: '600', color: RenovaTheme.colors.text },
  labelOn: { color: RenovaTheme.colors.accent },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  check: { fontSize: 16, color: RenovaTheme.colors.textSubtle, fontWeight: '700' },
  checkOn: { color: RenovaTheme.colors.accent },
  reset: { marginTop: 8, alignItems: 'center', padding: 10 },
  resetT: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.primary },
});
