/** Переключатель корзина / архив / активные объекты */
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';

export type ProjectBucket = 'active' | 'archived' | 'trashed';

type Props = {
  bucket: ProjectBucket;
  onChange: (b: ProjectBucket) => void;
  trashedCount?: number;
  archivedCount?: number;
  canManage?: boolean;
};

export function ProjectBucketToolbar({ bucket, onChange, trashedCount = 0, archivedCount = 0, canManage = true }: Props) {
  if (!canManage) return null;
  return (
    <View style={s.row}>
      <Pressable style={[s.iconBtn, bucket === 'active' && s.iconBtnOn]} onPress={() => onChange('active')} accessibilityLabel="Активные объекты">
        <Ionicons name="home-outline" size={20} color={bucket === 'active' ? RenovaTheme.colors.accent : RenovaTheme.colors.textMuted} />
        <Text style={[s.iconLabel, bucket === 'active' && s.iconLabelOn]}>Объекты</Text>
      </Pressable>
      <Pressable style={[s.iconBtn, bucket === 'archived' && s.iconBtnOn]} onPress={() => onChange('archived')} accessibilityLabel="Архив">
        <Ionicons name="archive-outline" size={20} color={bucket === 'archived' ? RenovaTheme.colors.accent : RenovaTheme.colors.textMuted} />
        <Text style={[s.iconLabel, bucket === 'archived' && s.iconLabelOn]}>Архив{archivedCount ? ` (${archivedCount})` : ''}</Text>
      </Pressable>
      <Pressable style={[s.iconBtn, bucket === 'trashed' && s.iconBtnOn]} onPress={() => onChange('trashed')} accessibilityLabel="Корзина">
        <Ionicons name="trash-outline" size={20} color={bucket === 'trashed' ? RenovaTheme.colors.danger : RenovaTheme.colors.textMuted} />
        <Text style={[s.iconLabel, bucket === 'trashed' && s.iconLabelOn]}>Корзина{trashedCount ? ` (${trashedCount})` : ''}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  iconBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: RenovaTheme.radius.md, backgroundColor: RenovaTheme.colors.surface, borderWidth: 1, borderColor: RenovaTheme.colors.borderLight },
  iconBtnOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: RenovaTheme.colors.accentMuted },
  iconLabel: { fontSize: 10, marginTop: 2, color: RenovaTheme.colors.textMuted, fontWeight: '600' },
  iconLabelOn: { color: RenovaTheme.colors.accent },
});
