/** План работ проекта — тип ремонта и этапы */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { STAGE_PLAN_LABELS, stagePlanLabel } from '@/constants/stagePlans';

export function RenovationPlanBadge({ renovationType, propertyType, stageNames }: {
  renovationType?: string; propertyType?: string; stageNames?: string[];
}) {
  const plan = STAGE_PLAN_LABELS[renovationType || 'cosmetic'];
  const stages = stageNames?.length ? stageNames : plan?.stages || [];
  const isHouse = propertyType === 'house';
  return (
    <View style={s.box}>
      <Text style={s.head}>📋 План работ · {stagePlanLabel(renovationType || 'cosmetic')}{isHouse ? ' · дом' : ' · квартира'}</Text>
      <Text style={s.flow}>{stages.join(' → ')}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  box: { backgroundColor: '#F0F9FF', borderRadius: 10, padding: 12, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: RenovaTheme.colors.primary },
  head: { fontWeight: '800', fontSize: 13, marginBottom: 4 },
  flow: { fontSize: 11, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
});
