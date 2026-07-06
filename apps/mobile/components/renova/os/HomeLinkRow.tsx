/** Строка-ссылка на главной — единые отступы и шрифты */
import { Pressable, Text } from 'react-native';
import { homeRowStyles, homeTypography } from '@/constants/homeTypography';

type Props = {
  title: string;
  onPress: () => void;
  /** Справа accent целиком — «Календарь →», «Настроить →» */
  variant?: 'row' | 'trailingLink';
  /** Приглушённый текст слева — «пусто», «Вид главной» */
  muted?: boolean;
  /** Подпись слева при variant="trailingLink" */
  leading?: string;
};

export function HomeLinkRow({ title, onPress, variant = 'row', muted, leading }: Props) {
  if (variant === 'trailingLink') {
    return (
      <Pressable style={homeRowStyles.linkRow} onPress={onPress} hitSlop={8} accessibilityRole="button">
        {leading ? (
          <Text style={[homeTypography.actionRowMuted, homeRowStyles.linkRowLeading]} numberOfLines={1}>
            {leading}
          </Text>
        ) : null}
        <Text style={homeTypography.link}>{title}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable style={homeRowStyles.linkRow} onPress={onPress} accessibilityRole="button">
      <Text
        style={[muted ? homeTypography.actionRowMuted : homeTypography.actionRow, homeRowStyles.linkRowLeading]}
        numberOfLines={1}
      >
        {title}
      </Text>
      <Text style={homeTypography.link}>→</Text>
    </Pressable>
  );
}
