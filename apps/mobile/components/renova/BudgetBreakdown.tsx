import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { api, BudgetBreakdown as BB } from '@/lib/api';
import { formatRub } from '@/constants/Theme';
import { getDetailLevel } from '@/lib/detailLevel';

export function BudgetBreakdown({ userId, projectId }: { userId: string; projectId: string }) {
  const [d, setD] = useState<BB | null>(null);
  const [fc, setFc] = useState<{ forecast_total: number; forecast_over: number; risk: string } | null>(null);
  const [alerts, setAlerts] = useState<{ category: string; over_pct: number }[]>([]);
  const [lvl, setLvl] = useState('standard');
  useEffect(() => { getDetailLevel().then(setLvl); api.budgetBreakdown(userId, projectId).then(setD).catch(() => {}); api.budgetForecast(userId, projectId).then(setFc).catch(() => {}); api.budgetCategoryAlerts(userId, projectId).then(setAlerts).catch(() => {}).catch(() => {}); }, [projectId]);
  if (!d) return null;
  const rows = lvl === 'brief'
    ? [{ l: 'План', v: d.budget_planned }, { l: 'Факт', v: d.budget_spent }]
    : [{ l: 'Работы', v: d.works }, { l: 'Материалы (план)', v: d.materials_plan }, { l: 'Материалы (факт)', v: d.materials_fact }, { l: 'Мусор', v: d.waste }, { l: 'Резерв', v: d.reserve }];
  return (
    <View style={s.box}>
      <Text style={s.head}>Бюджет по статьям</Text>
      {rows.map(r => <View key={r.l} style={s.row}><Text>{r.l}</Text><Text style={s.v}>{formatRub(r.v)}</Text></View>)}
      {alerts.length > 0 && lvl !== 'brief' && alerts.map(a => <Text key={a.category} style={s.warn}>⚠ {a.category}: +{a.over_pct}%</Text>)}
      {fc && lvl !== 'brief' && <Text style={s.sub}>Прогноз: {formatRub(fc.forecast_total)}{fc.risk==='high'?' ⚠':''}</Text>}
      {lvl === 'detailed' && <Text style={s.sub}>Итого план: {formatRub(d.total_planned)} · бюджет проекта: {formatRub(d.budget_planned)}</Text>}
      <Text style={s.sub}>Факт по статьям — с сервера (budget_spent). Список «Расходы» — unified без дублей.</Text>
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginVertical:10, backgroundColor:RenovaTheme.colors.surface, padding:12, borderRadius:10 }, head:{ fontWeight:'800', marginBottom:8 }, row:{ flexDirection:'row', justifyContent:'space-between', paddingVertical:4 }, v:{ fontWeight:'600' }, warn:{ color:'#b45309', fontSize:11, marginTop:4 }, sub:{ fontSize:11, color:'#666', marginTop:8 } });
