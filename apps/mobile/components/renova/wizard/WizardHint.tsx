/** Краткая подсказка в wizard — скрывается в режиме brief */
import { Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { useDetailLevel } from '@/lib/useDetailLevel';
import { wizardHintsVerbose } from '@/lib/detailLevelPolicy';

export function WizardHint({ brief, detailed }: { brief: string; detailed?: string }) {
  const level = useDetailLevel();
  if (!wizardHintsVerbose(level)) {
    return <Text style={s.brief}>{brief}</Text>;
  }
  return <Text style={s.detailed}>{detailed || brief}</Text>;
}

const s = StyleSheet.create({
  brief: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18, marginBottom: 10 },
  detailed: { fontSize: 13, color: RenovaTheme.colors.text, lineHeight: 19, marginBottom: 12 },
});
