/**
 * O-3 (live-audit-2): на десктопе (1280) мобильная вёрстка растягивалась на всю ширину —
 * кнопки по 1250 px, формы без max-width. Колонка ограничена и центрирована; на 375/768 рамка
 * прозрачна (ширина меньше предела), на native — ничего не меняет.
 */
import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { MAX_CONTENT_WIDTH } from '@/constants/layout';

export function WideScreenFrame({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: RenovaTheme.colors.background }}>
      <View style={{ flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH }}>{children}</View>
    </View>
  );
}
