import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { PortfolioGallery } from '@/components/renova/PortfolioGallery';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';
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

export function ContractorDirectory({
  userId,
  projectId,
  linkedContractorId,
  embedded,
  onLinked,
}: {
  userId: string;
  projectId?: string;
  linkedContractorId?: string | null;
  embedded?: boolean;
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
      Alert.alert('Исполнитель подключён', 'Он видит объект и может вести работы и смету.');
    } catch (e: unknown) {
      Alert.alert('Не удалось подключить', apiErrorMessage(e, 'Проверьте подключение к серверу'));
    } finally {
      setBusyId(null);
    }
  };

  if (!items.length) {
    return embedded ? null : <Text style={formMetaText.caption}>База исполнителей пуста</Text>;
  }

  return (
    <View style={embedded ? s.embeddedBox : s.box}>
      <Text style={embedded ? s.subHead : s.head}>Исполнители</Text>
      <Text style={[formMetaText.caption, s.listHint]}>Подключите подрядчика к этому объекту — у него может быть несколько заказчиков.</Text>
      {items.map((c) => {
        const linked = linkedContractorId === c.id;
        return (
          <View key={c.id} style={s.row}>
            <Text style={s.n}>{c.company || c.name}</Text>
            <Text style={formMetaText.caption}>
              Оценка {c.score ?? c.rating} · {c.specialties || '—'} · ★{c.rating} · {c.jobs_done} объектов
            </Text>
            <PortfolioGallery userId={userId} profileId={c.id} />
            {projectId && !linkedContractorId ? (
              <PrimaryButton
                title={busyId === c.id ? 'Подключение…' : 'Подключить к объекту'}
                variant="outline"
                compact
                disabled={!!busyId}
                onPress={() => link(c.id)}
              />
            ) : linked ? (
              <Text style={s.linked}>Подключён к объекту</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginVertical: 10 },
  embeddedBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.border,
  },
  head: { fontWeight: '800', marginBottom: 8, fontSize: 15 },
  subHead: { fontWeight: '700', marginBottom: 4, fontSize: 14 },
  listHint: { marginBottom: 8 },
  row: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: RenovaTheme.radius.md,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    gap: 6,
  },
  n: { fontWeight: '600', fontSize: 14 },
  linked: { ...formMetaText.caption, color: RenovaTheme.colors.success, fontWeight: '600' },
});
