/**
 * Поведение нижней шторки при открытой клавиатуре — в одном месте.
 *
 * Восемь шторок собраны «сырым» `<Modal>` с `justifyContent: 'flex-end'` и
 * не поднимались над клавиатурой. Считано для `CreateStageSheet` на 375:
 *
 *     высота листа ≈ 335 pt, клавиатура iOS ≈ 216 pt
 *     кнопка «Создать этап» лежит на 28…76 pt от низа
 *     → целиком под клавиатурой
 *
 * То же у `CreateWorkSheet` (5 полей), `BankStatementImportSheet` (поле на
 * 140 pt) и остальных: поля заполняешь вслепую, кнопку подтверждения не
 * видно.
 *
 * Правильное решение в репозитории есть — `SheetSurface`. Но у восьми шторок
 * своя вёрстка и свои размеры, и перевод их на общий компонент менял бы вид
 * каждой. Здесь вынесено только поведение: клавиатура и безопасная зона.
 * Оформление каждой шторки остаётся её собственным.
 */
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useBottomInset } from '@/lib/useTopInset';
import { RenovaTheme } from '@/constants/Theme';

/** Затемнение фона под шторкой. Было двумя значениями — 0.4 и 0.35. */
export const SHEET_BACKDROP = 'rgba(0,0,0,0.4)';

/**
 * Нижний отступ содержимого шторки: не меньше обычного, но и не меньше
 * зоны home indicator. Сама шторка при этом доходит до края экрана.
 */
export function useSheetBottomPadding(): number {
  const inset = useBottomInset();
  return Math.max(RenovaTheme.spacing.lg, inset + 8);
}

export function SheetKeyboardLayer({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={s.layer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // Фон под шторкой должен оставаться нажимаемым: тап по нему закрывает.
      pointerEvents="box-none"
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  layer: { flex: 1, justifyContent: 'flex-end' },
});
