/**
 * Clarity B/M + Polish P1: bottom sheet вместо Alert для decision flows.
 * Canon: primary/secondary/actions with explicit destructive hierarchy.
 */
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';

export type ActionConfirmAction = {
  label: string;
  onPress: () => void;
  /** destructive actions use dangerOutline, normal secondary actions use outline */
  destructive?: boolean;
};

export type ActionConfirmSheetProps = {
  visible: boolean;
  title: string;
  message: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  actions?: ActionConfirmAction[];
  onDismiss?: () => void;
  onClose: () => void;
};

export function ActionConfirmSheet({
  visible,
  title,
  message,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  actions,
  onDismiss,
  onClose,
}: ActionConfirmSheetProps) {
  const multi = actions && actions.length > 0;

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
      <Pressable style={s.backdrop} onPress={closeDismiss} accessibilityLabel="Закрыть">
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={s.handle} />
          <Text style={s.title}>{title}</Text>
          {message ? <Text style={s.message}>{message}</Text> : null}
          <ScrollView style={s.scroll} bounces={false} keyboardShouldPersistTaps="handled">
            <View style={s.actions}>
              {multi
                ? actions!.map((a, i) => (
                    <PrimaryButton
                      key={`${a.label}-${i}`}
                      title={a.label}
                      variant={a.destructive ? 'dangerOutline' : i === 0 ? 'primary' : 'outline'}
                      onPress={() => runThenClose(a.onPress)}
                    />
                  ))
                : (
                  <>
                    {primaryLabel && onPrimary ? (
                      <PrimaryButton
                        title={primaryLabel}
                        variant="primary"
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
              <Pressable onPress={closeDismiss} style={s.dismiss} hitSlop={8}>
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