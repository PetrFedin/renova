/** Вторичный текст форм — как «Квартира · 3 комн. · адрес» на главной */
import { StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export const formMetaText = StyleSheet.create({
  caption: {
    fontSize: 12,
    fontWeight: '500',
    color: RenovaTheme.colors.textMuted,
    lineHeight: 16,
  },
});

/** Объект для StyleSheet.create({ hint: metaCaptionStyle }) */
export const metaCaptionStyle = formMetaText.caption;
