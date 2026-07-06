/** Визуальная зона главной — «Сделать сейчас» / «Сводка» / «Детали» */
import { View, Text, Pressable, type ReactNode } from 'react-native';
import { homeRowStyles, homeTypography } from '@/constants/homeTypography';

type Props = {
  title?: string;
  /** Ссылка справа от заголовка — как «Календарь →» / «Все задачи →» */
  linkLabel?: string;
  onLinkPress?: () => void;
  children: ReactNode;
};

export function HomeZone({ title, linkLabel, onLinkPress, children }: Props) {
  return (
    <View style={homeRowStyles.zone}>
      {title ? (
        <View style={homeRowStyles.zoneHead}>
          <Text style={homeTypography.zoneLabel}>{title}</Text>
          {linkLabel && onLinkPress ? (
            <Pressable onPress={onLinkPress} hitSlop={8} accessibilityRole="button">
              <Text style={homeTypography.link}>{linkLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}
