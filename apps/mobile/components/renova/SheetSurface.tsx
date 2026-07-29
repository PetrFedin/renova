import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';

export type SheetSurfaceProps = {
  visible: boolean;
  onClose: () => void;
  busy?: boolean;
  title?: string;
  value?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  accessibilityLabel?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Shared bottom-sheet chrome for Renova operational surfaces.
 * Provides safe close semantics, keyboard avoidance, scrollable content,
 * safe-area padding and a footer that stays outside the scroll region.
 */
export function SheetSurface({
  visible,
  onClose,
  busy = false,
  title,
  value,
  subtitle,
  children,
  footer,
  accessibilityLabel,
  contentContainerStyle,
  testID,
}: SheetSurfaceProps) {
  const insets = useSafeAreaInsets();
  const closeSafely = () => {
    if (!busy) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={closeSafely}
    >
      <View style={styles.backdrop} testID={testID}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? 'Закрыть окно'}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={closeSafely}
        />
        <KeyboardAvoidingView
          style={styles.keyboardLayer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
        >
          <View
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, RenovaTheme.spacing.lg) }]}
            accessibilityViewIsModal
            accessibilityLabel={title || value || accessibilityLabel || 'Окно Renova'}
          >
            <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            {value ? <Text style={screenTypography.sheetValue}>{value}</Text> : null}
            {title ? <Text style={screenTypography.sheetTitle}>{title}</Text> : null}
            {subtitle ? <Text style={screenTypography.sheetSubtitle}>{subtitle}</Text> : null}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.content, contentContainerStyle]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export const sheetContentStyles = StyleSheet.create({
  section: { gap: RenovaTheme.spacing.sm },
  row: {
    minHeight: RenovaTheme.minTouch,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: RenovaTheme.spacing.md,
    paddingVertical: RenovaTheme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
  },
  label: { ...screenTypography.listMeta, marginTop: 0, flexShrink: 1 },
  value: { ...screenTypography.listTitle, textAlign: 'right', flexShrink: 1 },
  link: { ...screenTypography.listLink, marginTop: 0, textAlign: 'right' },
  note: { ...screenTypography.empty },
  fieldLabel: { ...screenTypography.section, marginTop: RenovaTheme.spacing.xs, marginBottom: 0 },
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
  actionStack: { gap: RenovaTheme.spacing.sm },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  keyboardLayer: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: RenovaTheme.radius.xl,
    borderTopRightRadius: RenovaTheme.radius.xl,
    paddingTop: RenovaTheme.spacing.sm,
    paddingHorizontal: RenovaTheme.spacing.xl,
    gap: RenovaTheme.spacing.sm,
    ...RenovaTheme.shadow.card,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: RenovaTheme.radius.pill,
    backgroundColor: RenovaTheme.colors.border,
    marginBottom: RenovaTheme.spacing.xs,
  },
  scroll: { flexShrink: 1 },
  content: { gap: RenovaTheme.spacing.sm, paddingBottom: RenovaTheme.spacing.sm },
  footer: {
    paddingTop: RenovaTheme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RenovaTheme.colors.border,
    gap: RenovaTheme.spacing.sm,
  },
});
