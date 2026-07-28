/**
 * Clarity B/M: bottom sheet вместо Alert для post-action CTA и multi-option меню.
 * Канон: slide Modal; primary/secondary ИЛИ actions[] (Clarity M).
 */
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';

export type ActionConfirmAction = {
  label: string;
  onPress: () => void;
  /** outline по умолчанию; первый без destructive = primary fill */
  destructive?: boolean;
};

export type ActionConfirmSheetProps = {
  visible: boolean;
  title: string;
  message: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDestructive?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Clarity M: ≥3 пункта меню (PDF, счёт, long-press) */
  actions?: ActionConfirmAction[];
  /** Clarity P: закрытие без выбора действия */
  onDismiss?: () => void;
  onClose: () => void;
};

export function ActionConfirmSheet({
  visible,
  title,
  message,
  primaryLabel,
  onPrimary,
  primaryDestructive,
  secondaryLabel,
  onSecondary,
  actions,
  onDismiss,
  onClose,
}: ActionConfirmSheetProps) {
  const multi = actions && actions.length > 0;
  /**
   * Clarity U: сначала закрываем sheet, затем action.
   * Иначе nested showActionConfirm из onPress мгновенно сбрасывается clearActionConfirm.
   */
  const runThenClose = (fn?: () => void) => {
    onClose();
    if (fn) queueMicrotask(fn);
  };
  const closeDismiss = () => {
    onDismiss?.();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={closeDismiss}>
      <Pressable style={s.backdrop} onPress={closeDismiss} accessibilityRole="button" accessibilityLabel="Закрыть подтверждение">
        <Pressable style={s.sheet} onStartShouldSetResponder={() => true}>
          <View style={s.handle} />
          <Text style={s.title}>{title}</Text>
          {message ? <Text style={s.message}>{message}</Text> : null}
          <ScrollView style={s.scroll} bounces={false} keyboardShouldPersistTaps="handled">
            <View style={s.actions}>
              {multi
                ? actions!.map((action, index) => (
                    <PrimaryButton
                      key={`${action.label}-${index}`}
                      title={action.label}
                      variant={action.destructive ? 'dangerOutline' : index === 0 ? 'primary' : 'outline'}
                      onPress={() => runThenClose(action.onPress)}
                    />
                  ))
                : (
                  <>
                    {primaryLabel && onPrimary ? (
                      <PrimaryButton
                        title={primaryLabel}
                        variant={primaryDestructive ? 'danger' : 'primary'}
                        onPress={() => runThenClose(onPrimary)}
                      />
                    ) : null}
                    {secondaryLabel && onSecondary ? (
                      <PrimaryButton
                        title={secondaryLabel}
                        variant="outline"
                        onPress={() => runThenClose(onSecondary)}
                      />
                    ) : null}
                  </>
                )}
              <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={closeDismiss} style={s.dismiss}>
                <Text style={s.dismissT}>Закрыть</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheet: {
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 10,
    maxHeight: '78%',
  },
  scroll: { flexGrow: 0 },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: RenovaTheme.colors.border,
    marginBottom: 8,
  },
  title: { fontSize: 17, fontWeight: '800', color: RenovaTheme.colors.text },
  message: { fontSize: 14, color: RenovaTheme.colors.textMuted, lineHeight: 20 },
  actions: { gap: 8, marginTop: 8 },
  dismiss: { alignItems: 'center', minHeight: RenovaTheme.minTouch, justifyContent: 'center' },
  dismissT: { fontSize: 14, fontWeight: '600', color: RenovaTheme.colors.textMuted },
});
