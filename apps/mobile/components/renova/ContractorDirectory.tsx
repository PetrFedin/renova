import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PortfolioGallery } from '@/components/renova/PortfolioGallery';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';

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

export function ContractorDirectory({ userId, embedded }: { userId: string; embedded?: boolean }) {
  const [items, setItems] = useState<C[]>([]);

  useEffect(() => {
    api
      .matchContractors(userId, 'capital', 'tiling')
      .then(setItems)
      .catch(() => api.listContractors(userId).then(setItems).catch(() => {}));
  }, [userId]);

  if (!items.length) {
    return embedded ? null : <Text style={s.empty}>База исполнителей пуста</Text>;
  }

  return (
    <View style={embedded ? s.embeddedBox : s.box}>
      <Text style={embedded ? s.subHead : s.head}>Исполнители</Text>
      {items.map((c) => (
        <View key={c.id} style={s.row}>
          <Text style={s.n}>{c.company || c.name}</Text>
          <Text style={s.sub}>
            Оценка {c.score ?? c.rating} · {c.specialties || '—'} · ★{c.rating} · {c.jobs_done} объектов
          </Text>
          <PortfolioGallery userId={userId} profileId={c.id} />
        </View>
      ))}
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
  subHead: { fontWeight: '700', marginBottom: 8, fontSize: 14 },
  row: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: RenovaTheme.radius.md,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  n: { fontWeight: '600', fontSize: 14 },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  empty: { color: RenovaTheme.colors.textMuted, margin: 10 },
});
