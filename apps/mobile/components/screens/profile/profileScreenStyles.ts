/** Общие стили экрана «Профиль» (заказчик / исполнитель) */
import { StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenLayout } from '@/constants/screenLayout';

export const profileScreenStyles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: RenovaTheme.colors.background,
  },
  content: screenLayout.contentStyle,
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: RenovaTheme.colors.primary,
    marginBottom: 4,
  },
  userName: {
    fontSize: 17,
    fontWeight: '700',
    color: RenovaTheme.colors.text,
    marginTop: 2,
  },
  userMeta: {
    fontSize: 14,
    color: RenovaTheme.colors.textMuted,
    marginTop: 4,
  },
  badge: {
    marginTop: 8,
    color: RenovaTheme.colors.success,
    fontWeight: '600',
    fontSize: 13,
  },
  tip: {
    fontSize: 12,
    color: RenovaTheme.colors.textMuted,
    lineHeight: 17,
    marginBottom: 12,
  },
  actionGap: {
    gap: 10,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.md,
    padding: 12,
    marginTop: 8,
    fontSize: 15,
    backgroundColor: RenovaTheme.colors.surface,
  },
  msg: {
    marginTop: 8,
    color: RenovaTheme.colors.textMuted,
    fontSize: 13,
  },
});
