/** Модал приглашения исполнителя — из PostCreate и чеклиста */
import { Modal, View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ContractorInvitePanel } from '@/components/renova/ContractorInvitePanel';

type Props = {
  visible: boolean;
  userId: string;
  projectId: string;
  projectName: string;
  linkedContractorId?: string | null;
  onClose: () => void;
  onLinked?: () => void;
};

export function ContractorInviteSheet({
  visible,
  userId,
  projectId,
  projectName,
  linkedContractorId,
  onClose,
  onLinked,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <ContractorInvitePanel
              userId={userId}
              projectId={projectId}
              projectName={projectName}
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
