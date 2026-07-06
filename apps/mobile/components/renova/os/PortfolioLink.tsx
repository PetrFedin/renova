/** Компактная ссылка на портфель — одна строка без карточки */
import { Text, StyleSheet, Pressable } from 'react-native';
import { homeLayout, homeTypography } from '@/constants/homeTypography';
import { useRenova } from '@/lib/context/RenovaContext';
import { useOsNavFromHere } from '@/lib/navigation';
import type { OsRole } from '@/constants/osSections';

export function PortfolioLink({ role }: { role: OsRole }) {
  const { projects, activeProject } = useRenova();
  const { pushScreen } = useOsNavFromHere(role);
  if (projects.length < 2) return null;

  const others = projects.filter((p) => p.id !== activeProject?.id).length;
  const label = others > 0
    ? `Ещё ${others} объект${others > 1 ? 'а' : ''} · портфель →`
    : `Все проекты (${projects.length}) →`;

  return (
    <Pressable style={s.row} onPress={() => pushScreen('/portfolio')} accessibilityRole="button">
      <Text style={homeTypography.actionRow} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: homeLayout.sectionGap,
  },
});
