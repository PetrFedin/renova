/** Модал приглашения исполнителя — из PostCreate и чеклиста */
import { Modal, View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ContractorInvitePanel } from '@/components/renova/ContractorInvitePanel';

type Props = {
  visible: boolean;
  userId: string;
  projectId: string;
  linkedContractorId?: string | null;
  onClose: () => void;
  onLinked?: () => void;
};

function stopPropagation(event: unknown): void {
  if (typeof event !== 'object' || event === null || !('stopPropagation' in event)) return;
  const stop = event.stopPropagation;
  if (typeof stop === 'function') stop.call(event);
}

export function ContractorInviteSheet({
  visible,
  userId,
  projectId,
  linkedContractorId,
  onClose,
  onLinked,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={stopPropagation}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <ContractorInvitePanel
              userId={userId}
              projectId={projectId}
              linkedContractorId={linkedContractorId}
              compact
              onLinked={() => {
                onLinked?.();
                onClose();
              }}
            />
          </ScrollView>
          <PrimaryButton title="Готово" variant="outline" onPress={onClose} fullWidth />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: RenovaTheme.colors.surface,
    borderTopLeftRadius: RenovaTheme.radius.xl,
    borderTopRightRadius: RenovaTheme.radius.xl,
    padding: RenovaTheme.spacing.lg,
    paddingBottom: 32,
    gap: 12,
  },
});
