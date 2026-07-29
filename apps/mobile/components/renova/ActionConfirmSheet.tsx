/**
 * Clarity B/M: bottom sheet вместо Alert для post-action CTA и multi-option меню.
 * Канон: shared SheetSurface; primary/secondary ИЛИ actions[].
 */
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface } from '@/components/renova/SheetSurface';

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
  const multi = Boolean(actions?.length);
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
    <SheetSurface
      visible={visible}
      title={title}
      subtitle={message || undefined}
      onClose={closeDismiss}
      accessibilityLabel={`Подтверждение: ${title}`}
      footer={
        <>
          {multi
            ? actions!.map((action, index) => (
                <PrimaryButton
                  key={`${action.label}-${index}`}
                  title={action.label}
                  variant={action.destructive ? 'dangerOutline' : index === 0 ? 'primary' : 'outline'}
                  accessibilityLabel={action.label}
                  onPress={() => runThenClose(action.onPress)}
                  fullWidth
                />
              ))
            : (
              <>
                {primaryLabel && onPrimary ? (
                  <PrimaryButton
                    title={primaryLabel}
                    variant={primaryDestructive ? 'danger' : 'primary'}
                    accessibilityLabel={primaryLabel}
                    onPress={() => runThenClose(onPrimary)}
                    fullWidth
                  />
                ) : null}
                {secondaryLabel && onSecondary ? (
                  <PrimaryButton
                    title={secondaryLabel}
                    variant="outline"
                    accessibilityLabel={secondaryLabel}
                    onPress={() => runThenClose(onSecondary)}
                    fullWidth
                  />
                ) : null}
              </>
            )}
          <PrimaryButton
            title="Закрыть"
            variant="ghost"
            accessibilityLabel="Закрыть подтверждение"
            onPress={closeDismiss}
            fullWidth
          />
        </>
      }
    >
      {null}
    </SheetSurface>
  );
}
