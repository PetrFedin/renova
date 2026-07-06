/** Компактная подсказка «заполните профиль» — dismiss на проект */
import { useEffect, useState } from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RenovaTheme } from '@/constants/Theme';
import { homeLayout, homeTypography } from '@/constants/homeTypography';
import type { ProjectDetail } from '@/lib/api';
import { formatProfileGapLabel, getProjectProfileGaps } from '@/lib/domain/projectProfileGaps';
import type { OsRole } from '@/constants/osSections';
import { useOsNavFromHere } from '@/lib/navigation';

const dismissKey = (projectId: string) => `renova_profile_hint_dismiss_${projectId}`;

export function ProjectProfileHint({ project, role }: { project: ProjectDetail; role: OsRole }) {
  const { pushTab } = useOsNavFromHere(role);
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(dismissKey(project.id))
      .then((v) => setDismissed(v === '1'))
      .catch(() => setDismissed(false));
  }, [project.id]);

  const gaps = getProjectProfileGaps(project);
  if (dismissed === null || dismissed || !gaps.length) return null;
  const gapLabel = formatProfileGapLabel(gaps);

  return (
    <Pressable
      style={s.row}
      onPress={() => pushTab('object', 'profile')}
      accessibilityRole="button"
    >
      <Text style={s.text} numberOfLines={1}>Добавьте {gapLabel}</Text>
      <Text style={homeTypography.link}>Профиль →</Text>
      <Pressable
        hitSlop={8}
        onPress={(e) => {
          e.stopPropagation?.();
          AsyncStorage.setItem(dismissKey(project.id), '1').catch(() => {});
          setDismissed(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Скрыть подсказку"
      >
        <Text style={s.dismiss}>×</Text>
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: homeLayout.innerGap,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: homeLayout.innerGap,
    borderRadius: 10,
    backgroundColor: RenovaTheme.colors.borderLight,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  text: { flex: 1, fontSize: 12, color: RenovaTheme.colors.textMuted },
  dismiss: { fontSize: 18, color: RenovaTheme.colors.textSubtle, lineHeight: 18, paddingHorizontal: 4 },
});
