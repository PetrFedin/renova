import { StyleSheet } from 'react-native';

import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';

export const formSurfaceStyles = StyleSheet.create({
  container: {
    gap: RenovaTheme.spacing.sm,
    paddingVertical: RenovaTheme.spacing.md,
    marginBottom: RenovaTheme.spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
  },
  title: { ...screenTypography.listTitle },
  hint: { ...screenTypography.listMeta, marginBottom: RenovaTheme.spacing.xs },
  label: { ...screenTypography.section, marginTop: RenovaTheme.spacing.xs, marginBottom: 0 },
  input: {
    minHeight: RenovaTheme.minTouch,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.sm,
    paddingHorizontal: RenovaTheme.spacing.md,
    paddingVertical: RenovaTheme.spacing.sm,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.surface,
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  splitRow: { flexDirection: 'row', gap: RenovaTheme.spacing.sm },
  splitCell: { flex: 1 },
  chipTouch: { minHeight: RenovaTheme.minTouch, justifyContent: 'center' },
  actionStack: { gap: RenovaTheme.spacing.sm, marginTop: RenovaTheme.spacing.xs },
  collapsedAction: {
    minHeight: RenovaTheme.minTouch,
    justifyContent: 'center',
    paddingVertical: RenovaTheme.spacing.sm,
    marginTop: RenovaTheme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RenovaTheme.colors.border,
  },
  collapsedTitle: { ...screenTypography.listLink, marginTop: 0 },
  collapsedMeta: { ...screenTypography.listMeta },
});
