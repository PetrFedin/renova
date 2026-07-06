/** Компактная «дорожка» шагов hub «Объект» */
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';

const STEPS: { id: ObjectTabId; label: string; num: number }[] = [
  { id: 'profile', label: 'Данные объекта', num: 1 },
  { id: 'rooms', label: 'Комнаты', num: 2 },
  { id: 'estimate', label: 'Смета', num: 3 },
  { id: 'plan', label: 'План', num: 4 },
];

export function ObjectTabProgress({
  active,
  onChange,
}: {
  active: ObjectTabId;
  onChange: (tab: ObjectTabId) => void;
}) {
  const activeIdx = STEPS.findIndex((s) => s.id === active);

  return (
    <View style={s.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {STEPS.map((step, idx) => {
          const done = idx < activeIdx;
          const current = step.id === active;
          return (
            <View key={step.id} style={s.stepWrap}>
              <Pressable
                style={[s.step, current && s.stepCurrent, done && s.stepDone]}
                onPress={() => onChange(step.id)}
                accessibilityRole="button"
                accessibilityLabel={`Шаг ${step.num}: ${step.label}`}
              >
                <Text style={[s.num, current && s.numCurrent, done && s.numDone]}>{step.num}</Text>
                <Text style={[s.label, current && s.labelCurrent]} numberOfLines={1}>{step.label}</Text>
              </Pressable>
              {idx < STEPS.length - 1 ? <Text style={s.sep}>›</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: RenovaTheme.colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepWrap: { flexDirection: 'row', alignItems: 'center' },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  stepCurrent: { borderColor: RenovaTheme.colors.primary, backgroundColor: RenovaTheme.colors.infoBg },
  stepDone: { borderColor: '#86efac', backgroundColor: '#f0fdf4' },
  num: {
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: 20,
    fontSize: 11,
    fontWeight: '800',
    color: RenovaTheme.colors.textMuted,
    backgroundColor: RenovaTheme.colors.background,
    overflow: 'hidden',
  },
  numCurrent: { color: RenovaTheme.colors.surface, backgroundColor: RenovaTheme.colors.primary },
  numDone: { color: '#166534', backgroundColor: '#dcfce7' },
  label: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted, maxWidth: 72 },
  labelCurrent: { color: RenovaTheme.colors.primary },
  sep: { fontSize: 14, color: RenovaTheme.colors.textSubtle, marginHorizontal: 2 },
});
