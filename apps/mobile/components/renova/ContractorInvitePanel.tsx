/** Подключение исполнителя к объекту */
import { useState } from 'react';
import { View, Text, StyleSheet, Share, Alert } from 'react-native';
import { AssignmentRequestsCard } from '@/components/renova/AssignmentRequestsCard';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/formatPhone';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { ContractorDirectory } from '@/components/renova/ContractorDirectory';
import { RenovaTheme } from '@/constants/Theme';
import { StatusPill } from '@/components/ui/StatusPill';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { messengerShareMessage } from '@/lib/messengerGap';

type Props = {
  userId: string;
  projectId: string;
  linkedContractorId?: string | null;
  embedded?: boolean;
  compact?: boolean;
  onLinked?: () => void;
};

function projectLinkCode(projectId: string): string {
  return projectId.slice(0, 8).toUpperCase();
}

export function ContractorInvitePanel({
  userId,
  projectId,
  linkedContractorId,
  embedded,
  compact,
  onLinked,
}: Props) {
  const linked = Boolean(linkedContractorId);
  const [releasing, setReleasing] = useState(false);

  const release = async () => {
    setReleasing(true);
    try {
      await api.releaseContractor(userId, projectId);
      onLinked?.();
    } catch (e: unknown) {
      // 409: уже есть начатые этапы, платежи или подписи — сервер объясняет, что сделать сначала
      Alert.alert('Заменить исполнителя пока нельзя', apiErrorMessage(e, 'Проверьте подключение'));
    } finally {
      setReleasing(false);
    }
  };

  const askRelease = () =>
    showActionConfirm({
      title: 'Заменить исполнителя?',
      message: 'Исполнитель будет отключён от объекта. Данные объекта сохранятся, смету нужно будет согласовать заново. Затем вы сможете выбрать другого исполнителя.',
      primaryLabel: 'Отключить',
      primaryDestructive: true,
      onPrimary: () => { void release(); },
      secondaryLabel: 'Отмена',
    });

  return (
    <View style={[embedded || compact ? s.embedded : s.box]}>
      {linked ? (
        <View style={s.statusRow}>
          <StatusPill label="Подключён" tone="success" />
          <Text style={s.statusText}>Исполнитель ведёт этот объект</Text>
          <PrimaryButton
            title={releasing ? '…' : 'Заменить исполнителя'}
            variant="outline"
            compact
            disabled={releasing}
            onPress={askRelease}
          />
        </View>
      ) : (
        <>
          <AssignmentRequestsCard userId={userId} projectId={projectId} onResolved={onLinked} />
          <View style={s.codeRow}>
            <Text style={s.codeLabel}>Код объекта</Text>
            <Text style={s.codeValue}>{projectLinkCode(projectId)}</Text>
          </View>
          <PrimaryButton
            title="Поделиться кодом (WhatsApp / Telegram)"
            variant="outline"
            compact
            onPress={() => {
              const code = projectLinkCode(projectId);
              const message = messengerShareMessage(
                `Код объекта Renova: ${code}`,
                'приглашение исполнителя',
              );
              void Share.share({ message, title: 'Renova' });
            }}
          />
          <Text style={s.gapHint}>
            Нет native WhatsApp API — только системное «Поделиться». Чат объекта — внутри Renova.
          </Text>
        </>
      )}

      <ContractorDirectory
        userId={userId}
        projectId={projectId}
        linkedContractorId={linkedContractorId}
        embedded
        linkedOnly={linked}
        onLinked={onLinked}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 10 },
  embedded: { gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { flex: 1, fontSize: 14, color: RenovaTheme.colors.text },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: RenovaTheme.colors.borderLight,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  codeLabel: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  codeValue: { fontSize: 15, fontWeight: '800', color: RenovaTheme.colors.text, letterSpacing: 1 },
  gapHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, lineHeight: 15 },
});
