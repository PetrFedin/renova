/** Планировщик бюджета — рыночная оценка для проекта (справочно) */
import { useState } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { BudgetPlannerPanel } from '@/components/renova/BudgetPlannerPanel';
import { useRenova } from '@/lib/context/RenovaContext';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { calcRoomMetrics } from '@/lib/calc-engine';
import type { MarketEstimate } from '@/constants/regions';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';

export default function BudgetPlannerScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { activeProject } = useRenova();
  const room = activeProject?.rooms?.[0];
  const m = room
    ? calcRoomMetrics({ lengthM: room.length_m, widthM: room.width_m, heightM: room.height_m, openingsSqM: room.openings_sq_m ?? 2 })
    : { floorSqM: 12, wallSqM: 24, perimeterM: 14 };
  const [workTypes, setWorkTypes] = useState<string[]>(['painting']);
  const [regionCode, setRegionCode] = useState('moscow');
  const [complexity, setComplexity] = useState(1);
  const [laborShare, setLaborShare] = useState(0.5);
  const [estimate, setEstimate] = useState<MarketEstimate | null>(null);
  const [metrics, setMetrics] = useState({
    floor_sq_m: m.floorSqM,
    wall_sq_m: m.wallSqM,
    perimeter_m: m.perimeterM,
    outlets_count: room?.outlets_count || 0,
    plumbing_points: room?.plumbing_points || 0,
  });

  return (
    <>
      <BackHeader title="Планировщик бюджета" returnTo={returnTo} subtitle="Справочная рыночная оценка" />
      <ReadOnlyBanner />
      <ScrollView style={{ flex: 1, backgroundColor: RenovaTheme.colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text style={s.disclaimer}>
          Справочно: расчёт по рынку не попадает в учёт автоматически. План проекта — из сметы; факт — из чеков и записей расходов.
        </Text>
        <BudgetPlannerPanel
          workTypes={workTypes}
          onWorkTypesChange={setWorkTypes}
          regionCode={regionCode}
          onRegionChange={setRegionCode}
          metrics={metrics}
          onMetricsChange={(next) => setMetrics((previous) => ({ ...previous, ...next }))}
          complexity={complexity}
          onComplexityChange={setComplexity}
          laborShare={laborShare}
          onLaborShareChange={setLaborShare}
          onEstimate={setEstimate}
        />
        {estimate ? (
          <Text style={s.disclaimer}>
            Оценка {formatRub(estimate.grand_total)} — ориентир. План проекта берётся из сметы объекта: чтобы изменить его, обновите смету и зафиксируйте её.
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  disclaimer: {
    fontSize: 12,
    color: RenovaTheme.colors.textMuted,
    lineHeight: 17,
    marginBottom: 12,
    padding: 10,
    backgroundColor: RenovaTheme.colors.warningBg,
    borderRadius: 8,
  },
});
