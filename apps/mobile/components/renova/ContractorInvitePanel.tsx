/** Подключение исполнителя к объекту */
import { View, Text, StyleSheet } from 'react-native';
import { ContractorDirectory } from '@/components/renova/ContractorDirectory';
import { RenovaTheme } from '@/constants/Theme';
import { StatusPill } from '@/components/ui/StatusPill';

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

  return (
    <View style={[embedded || compact ? s.embedded : s.box]}>
      {linked ? (
        <View style={s.statusRow}>
          <StatusPill label="Подключён" tone="success" />
          <Text style={s.statusText}>Исполнитель ведёт этот объект</Text>
        </View>
      ) : (
        <View style={s.codeRow}>
          <Text style={s.codeLabel}>Код объекта</Text>
          <Text style={s.codeValue}>{projectLinkCode(projectId)}</Text>
        </View>
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
});
