import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { api } from '@/lib/api';
import { formatRub } from '@/constants/Theme';
import { getDetailLevel } from '@/lib/detailLevel';

export function BudgetScenario({ userId, projectId }: { userId: string; projectId: string }) {
  const [d, setD] = useState<{ delta: number; new_total: number } | null>(null);
  const [lvl, setLvl] = useState('standard');
  useEffect(() => { getDetailLevel().then(setLvl); api.budgetScenario(userId, projectId, 10).then(setD).catch(() => {}); }, [projectId]);
  if (!d || lvl === 'brief') return null;
  return (
    <View style={s.box}><Text style={s.head}>Сценарий +10% материалы</Text><Text>Δ {formatRub(d.delta)} → {formatRub(d.new_total)}</Text></View>
  );
}
const s = StyleSheet.create({ box:{ marginTop:8, padding:10, backgroundColor:'#fef3c7', borderRadius:8 }, head:{ fontWeight:'700', marginBottom:4 } });
