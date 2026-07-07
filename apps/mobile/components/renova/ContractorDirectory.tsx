import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/formatPhone';
import { useRenova } from '@/lib/context/RenovaContext';

type C = {
  id: string;
  name: string;
  company?: string;
  specialties?: string;
  rating: number;
  jobs_done: number;
  city?: string;
  score?: number;
};

function contractorTitle(c: C): string {
  return c.company || c.name;
}

function contractorMeta(c: C): string {
  const parts: string[] = [];
  if (c.rating) parts.push(`★${c.rating}`);
  if (c.specialties) parts.push(c.specialties.split(',')[0]?.trim() || c.specialties);
  if (c.jobs_done) parts.push(`${c.jobs_done} объектов`);
  return parts.join(' · ');
}

export function ContractorDirectory({
  userId,
  projectId,
  linkedContractorId,
  embedded,
  linkedOnly,
  onLinked,
}: {
  userId: string;
  projectId?: string;
  linkedContractorId?: string | null;
  embedded?: boolean;
  /** Только подключённый — без каталога */
  linkedOnly?: boolean;
  onLinked?: () => void;
}) {
  const { loadProject } = useRenova();
  const [items, setItems] = useState<C[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api
      .matchContractors(userId, 'capital', 'tiling')
      .then(setItems)
      .catch(() => api.listContractors(userId).then(setItems).catch(() => {}));
  }, [userId]);

  const link = async (contractorId: string) => {
    if (!projectId) return;
    setBusyId(contractorId);
    try {
      await api.linkContractor(userId, projectId, contractorId);
      await loadProject(projectId).catch(() => {});
      onLinked?.();
    } catch (e: unknown) {
      Alert.alert('Не удалось подключить', apiErrorMessage(e, 'Проверьте подключение'));
    } finally {
      setBusyId(null);
    }
  };

  const visible = linkedOnly && linkedContractorId
    ? items.filter((c) => c.id === linkedContractorId)
    : items;

  if (!visible.length) {
    return embedded ? (
      <Text style={s.empty}>{linkedOnly ? 'Исполнитель не найден в каталоге' : 'Нет исполнителей в базе'}</Text>
    ) : (
      <Text style={s.empty}>База исполнителей пуста</Text>
    );
  }

  return (
    <View style={embedded ? s.embeddedBox : s.box}>
      {visible.map((c) => {
        const isLinked = linkedContractorId === c.id;
        return (
          <View key={c.id} style={[s.card, isLinked && s.cardLinked]}>
            <Text style={s.name}>{contractorTitle(c)}</Text>
            <Text style={s.meta}>{contractorMeta(c)}</Text>
            {projectId && !linkedContractorId ? (
              <PrimaryButton
                title={busyId === c.id ? '…' : 'Подключить'}
                variant="outline"
                compact
                disabled={!!busyId}
                onPress={() => link(c.id)}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginVertical: 10, gap: 8 },
  embeddedBox: { gap: 8 },
  card: {
    padding: 12,
    borderRadius: RenovaTheme.radius.md,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
    gap: 6,
  },
  cardLinked: {
    borderColor: RenovaTheme.colors.successBorder,
    backgroundColor: RenovaTheme.colors.successBg,
  },
  name: { fontWeight: '700', fontSize: 15, color: RenovaTheme.colors.text },
  meta: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  empty: { fontSize: 14, color: RenovaTheme.colors.textMuted },
});
