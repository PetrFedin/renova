/** Чеклист настройки объекта на главной — один CTA «Продолжить» */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { homeLayout } from '@/constants/homeTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { Card } from '@/components/ui/Card';
import type { ProjectDetail } from '@/lib/api';
import type { ProjectOsSnapshot } from '@/lib/domain/osTypes';
import {
  buildSetupChecklist,
  nextSetupItem,
  setupChecklistProgress,
  shouldShowSetupChecklist,
} from '@/lib/domain/buildSetupChecklist';
import type { OsRole } from '@/constants/osSections';
import { useOsNavFromHere } from '@/lib/navigation';

const dismissKey = (projectId: string) => `renova_setup_checklist_dismiss_${projectId}`;

export function HomeSetupChecklist({
  project,
  snap,
  role,
}: {
  project: ProjectDetail;
  snap: ProjectOsSnapshot;
  role: OsRole;
}) {
  const { pushNav } = useOsNavFromHere(role);
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(dismissKey(project.id))
      .then((v) => setDismissed(v === '1'))
      .catch(() => setDismissed(false));
  }, [project.id]);

  const items = useMemo(() => buildSetupChecklist(project, snap, role), [project, snap, role]);
  const progress = setupChecklistProgress(items);
  const next = nextSetupItem(items);
  const visible = dismissed !== null && shouldShowSetupChecklist(items, dismissed);

  if (!visible) return null;

  return (
    <Card variant="info" style={s.wrap}>
      <View style={s.headRow}>
        <Text style={s.title}>Настройка объекта</Text>
        <Text style={s.progress}>{progress}%</Text>
        <Pressable
          hitSlop={8}
          onPress={() => {
            AsyncStorage.setItem(dismissKey(project.id), '1').catch(() => {});
            setDismissed(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Скрыть чеклист"
        >
          <Text style={s.dismiss}>×</Text>
        </Pressable>
      </View>
      <Text style={s.sub}>Продолжите настройку — так быстрее выйти на ремонт.</Text>
      {items.map((item) => (
        <View key={item.id} style={s.row}>
          <Ionicons
            name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={item.done ? RenovaTheme.colors.success : RenovaTheme.colors.textSubtle}
          />
          <Text style={[s.label, item.done && s.labelDone]}>{item.label}</Text>
        </View>
      ))}
      {next ? (
        <PrimaryButton
          title={`Продолжить: ${next.label}`}
          onPress={() => pushNav(next.href)}
          fullWidth
        />
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: homeLayout.sectionGap },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  title: { flex: 1, fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  progress: { fontSize: RenovaTheme.fontSize.caption, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.infoText },
  dismiss: { fontSize: 20, color: RenovaTheme.colors.textSubtle, paddingHorizontal: 4 },
  sub: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  label: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.text },
  labelDone: { color: RenovaTheme.colors.textMuted },
});
