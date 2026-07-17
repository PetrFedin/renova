/** Иконки archive/trash/restore на карточке объекта — справа снизу, без текста */
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import type { ProjectBucket } from '@/components/renova/ProjectBucketToolbar';

type Props = {
  bucket: ProjectBucket;
  onArchive?: () => void;
  onTrash?: () => void;
  onRestore?: () => void;
  onUnarchive?: () => void;
  onPurge?: () => void;
};

function IconBtn({
  name,
  color,
  onPress,
  danger,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  if (!onPress) return null;
  return (
    <Pressable
      style={[s.btn, danger && s.btnDanger]}
      onPress={(e) => {
        e?.stopPropagation?.();
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
    >
      <Ionicons name={name} size={18} color={color} />
    </Pressable>
  );
}

export function ProjectCardLifecycleIcons({
  bucket,
  onArchive,
  onTrash,
  onRestore,
  onUnarchive,
  onPurge,
}: Props) {
  return (
    <View style={s.wrap} pointerEvents="box-none">
      {bucket === 'active' ? (
        <>
          <IconBtn name="archive-outline" color={RenovaTheme.colors.textMuted} onPress={onArchive} />
          <IconBtn name="trash-outline" color={RenovaTheme.colors.danger} onPress={onTrash} danger />
        </>
      ) : null}
      {bucket === 'archived' ? (
        <>
          <IconBtn name="arrow-undo-outline" color={RenovaTheme.colors.accent} onPress={onUnarchive} />
          <IconBtn name="trash-outline" color={RenovaTheme.colors.danger} onPress={onTrash} danger />
        </>
      ) : null}
      {bucket === 'trashed' ? (
        <>
          <IconBtn name="arrow-undo-outline" color={RenovaTheme.colors.accent} onPress={onRestore} />
          <IconBtn name="close-circle-outline" color={RenovaTheme.colors.danger} onPress={onPurge} danger />
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  btn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  btnDanger: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
});
