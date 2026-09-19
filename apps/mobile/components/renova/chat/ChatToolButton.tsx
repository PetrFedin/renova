/**
 * Кнопка панели ввода в чате.
 *
 * Панель была набрана эмодзи прямо в тексте: `📷 📎 ✓? 💳`. Это самый частый
 * экран приложения, и там сразу три беды.
 *
 * Во-первых, эмодзи рисует система: они разного веса, разной ширины и в цвете,
 * поэтому ряд выглядит разнокалиберным рядом со строгими Ionicons на других
 * экранах. Канон приводит ровно этот случай как запрещённый.
 *
 * Во-вторых, ни у одной не было `accessibilityLabel`: для незрячего человека
 * кнопка называлась «камера со вспышкой» или вовсе не читалась.
 *
 * В-третьих, в режиме только-чтения кнопки выглядели работающими:
 * `disabled={!canWrite}`, а вид не менялся ни на пиксель. Человек жал и не
 * получал ни результата, ни объяснения.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/ui/Pressable';
import { RenovaTheme } from '@/constants/Theme';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  /** Что делает кнопка — для экранного диктора и для подсказки. */
  label: string;
  /** Почему кнопка выключена. Читается диктором вместе с label. */
  disabledHint?: string;
  disabled?: boolean;
  onPress: () => void;
};

export function ChatToolButton({ icon, label, disabledHint, disabled, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={disabled ? disabledHint : undefined}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={s.btn}
    >
      <View style={s.inner}>
        <Ionicons
          name={icon}
          size={20}
          // Выключенная кнопка должна выглядеть выключенной.
          color={disabled ? RenovaTheme.colors.textSubtle : RenovaTheme.colors.text}
        />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    minWidth: RenovaTheme.minTouch,
    minHeight: RenovaTheme.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: { alignItems: 'center', justifyContent: 'center' },
});
