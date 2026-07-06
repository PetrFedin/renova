import { RenovaTheme } from '@/constants/Theme';
const tintColorLight = '#2f95dc';
const tintColorDark = RenovaTheme.colors.surface;

export default {
  light: {
    text: '#000',
    background: RenovaTheme.colors.surface,
    tint: tintColorLight,
    tabIconDefault: '#ccc',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: RenovaTheme.colors.surface,
    background: '#000',
    tint: tintColorDark,
    tabIconDefault: '#ccc',
    tabIconSelected: tintColorDark,
  },
};
