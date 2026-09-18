/**
 * Нажатие должно подтверждаться в момент касания.
 *
 * В приложении 410 нажимаемых элементов, и все — `Pressable` из react-native
 * напрямую. У 396 из них не было ни `pressed`-состояния, ни `android_ripple`:
 * палец опускается, под ним ничего не меняется, и до появления результата
 * человек не знает, попал ли он вообще. `PrimaryButton` сделан правильно и
 * закрывает 318 мест, но всё остальное — строки списков, вкладки, чипы,
 * иконки — оставалось без отклика.
 *
 * Чинить это в 396 местах нельзя: решение должно быть одно и в одном месте.
 * Поэтому здесь обёртка над штатным `Pressable` с откликом по умолчанию,
 * а импорты переведены на неё.
 *
 * Своё поведение остаётся своим: если вызывающий передал `style` функцией,
 * значит он сам разбирает состояние нажатия — тогда обёртка не вмешивается.
 * Так `PrimaryButton` (0.85), `Card` (0.88) и остальные семь компонентов,
 * где отклик уже был, продолжают работать как раньше, без наложения.
 */
import { type ComponentProps } from 'react';
import { Pressable as RNPressable, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';

/** Отклик на нажатие. Одно значение на всё приложение — раньше их было пять. */
export const PRESSED_OPACITY = 0.85;

/** Выключенный элемент виден как выключенный, а не как обычный. */
export const DISABLED_OPACITY = 0.45;

// Повторяем набор свойств штатного Pressable ровно: обёртка не должна
// сужать то, что вызывающие уже передают (title на вебе, свои типы события).
type Props = ComponentProps<typeof RNPressable>;

export function Pressable({ style, disabled, ...rest }: Props) {
  // Функция в style означает, что состояние разбирают снаружи — не мешаем.
  if (typeof style === 'function') {
    return <RNPressable style={style} disabled={disabled} {...rest} />;
  }

  return (
    <RNPressable
      disabled={disabled}
      style={({ pressed }: PressableStateCallbackType) => [
        style as StyleProp<ViewStyle>,
        disabled ? { opacity: DISABLED_OPACITY } : pressed ? { opacity: PRESSED_OPACITY } : null,
      ]}
      {...rest}
    />
  );
}
