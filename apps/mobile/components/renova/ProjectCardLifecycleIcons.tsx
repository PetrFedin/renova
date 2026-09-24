/** Иконки archive/trash/restore на карточке объекта — справа снизу, без текста */
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import type { ProjectBucket } from '@/components/renova/ProjectBucketToolbar';

type LifecyclePressEvent = {
  stopPropagation?: () => void;
  preventDefault?: () => void;
};

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
  label,
  color,
  onPress,
  danger,
}: {
  name: keyof typeof Ionicons.glyphMap;
  /**
   * What the button does, in words.
   *
   * This used to be the Ionicons glyph, so VoiceOver read "archive-outline",
   * "trash-outline", "close-circle-outline". Two of the four are destructive
   * and one deletes permanently, so the one user who cannot see the icon was
   * told the least about what the button would do.
   */
  label: string;
  color: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  if (!onPress) return null;
  return (
    <Pressable
      style={[s.btn, danger && s.btnDanger]}
      onPress={(event: LifecyclePressEvent) => {
        // Web: не даём клику уйти на карточку проекта
        event.stopPropagation?.();
        event.preventDefault?.();
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
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
          <IconBtn name="archive-outline" label="Архивировать объект" color={RenovaTheme.colors.textMuted} onPress={onArchive} />
          <IconBtn name="trash-outline" label="Переместить объект в корзину" color={RenovaTheme.colors.danger} onPress={onTrash} danger />
        </>
      ) : null}
      {bucket === 'archived' ? (
        <>
          <IconBtn name="arrow-undo-outline" label="Вернуть объект из архива" color={RenovaTheme.colors.accent} onPress={onUnarchive} />
          <IconBtn name="trash-outline" label="Переместить объект в корзину" color={RenovaTheme.colors.danger} onPress={onTrash} danger />
        </>
      ) : null}
      {bucket === 'trashed' ? (
        <>
          <IconBtn name="arrow-undo-outline" label="Восстановить объект из корзины" color={RenovaTheme.colors.accent} onPress={onRestore} />
          <IconBtn name="close-circle-outline" label="Удалить объект навсегда" color={RenovaTheme.colors.danger} onPress={onPurge} danger />
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
    zIndex: 10,
    elevation: 10,
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
