/** Подключение исполнителя к объекту — каталог + статус */
import { View, Text, StyleSheet } from 'react-native';
import { ContractorDirectory } from '@/components/renova/ContractorDirectory';
import { RenovaTheme } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';

type Props = {
  userId: string;
  projectId: string;
  projectName: string;
  linkedContractorId?: string | null;
  compact?: boolean;
  onLinked?: () => void;
};

export function ContractorInvitePanel({
  userId,
  projectId,
  projectName,
  linkedContractorId,
  compact,
  onLinked,
}: Props) {
  const linked = Boolean(linkedContractorId);

  return (
    <View style={compact ? s.compact : s.box}>
      <Text style={s.head}>{linked ? 'Исполнитель подключён' : 'Подключите исполнителя'}</Text>
      <Text style={formMetaText.caption}>
        {linked
          ? 'Подрядчик видит объект, этапы и смету. Можно сменить в профиле.'
          : `Объект «${projectName}». Выберите из базы Renova — исполнитель получит доступ к ремонту.`}
      </Text>
      {!linked ? (
        <Text style={s.codeHint}>
          Код объекта для связи: {projectId.slice(0, 8).toUpperCase()}
        </Text>
      ) : null}
      <ContractorDirectory
        userId={userId}
        projectId={projectId}
        linkedContractorId={linkedContractorId}
        embedded
        onLinked={onLinked}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 8 },
  compact: { gap: 6 },
  head: { fontSize: 16, fontWeight: '800', color: RenovaTheme.colors.text },
  codeHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, letterSpacing: 0.5 },
});
