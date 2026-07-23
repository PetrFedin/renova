/** Планировщик бюджета — рыночная оценка для проекта (справочно) */
import { useState } from 'react';
import { ScrollView, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { BudgetPlannerPanel } from '@/components/renova/BudgetPlannerPanel';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { calcRoomMetrics } from '@/lib/calc-engine';
import { api } from '@/lib/api';
import type { MarketEstimate } from '@/constants/regions';
import { ReadOnlyBanner, useWriteAllowed } from '@/components/renova/ReadOnlyGuard';

export default function BudgetPlannerScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user, activeProject, loadProject, readOnly } = useRenova();
  const canWrite = useWriteAllowed();
  const room = activeProject?.rooms?.[0];
  const m = room
    ? calcRoomMetrics({ lengthM: room.length_m, widthM: room.width_m, heightM: room.height_m, openingsSqM: room.openings_sq_m ?? 2 })
    : { floorSqM: 12, wallSqM: 24, perimeterM: 14 };
  const [workTypes, setWorkTypes] = useState<string[]>(['painting']);
  const [regionCode, setRegionCode] = useState('moscow');
  const [complexity, setComplexity] = useState(1);
  const [laborShare, setLaborShare] = useState(0.5);
  const [estimate, setEstimate] = useState<MarketEstimate | null>(null);
  const [applying, setApplying] = useState(false);
  const [metrics, setMetrics] = useState({
    floor_sq_m: m.floorSqM,
    wall_sq_m: m.wallSqM,
    perimeter_m: m.perimeterM,
    outlets_count: room?.outlets_count || 0,
    plumbing_points: room?.plumbing_points || 0,
  });

  async function applyToPlan() {
    if (!user || !activeProject || !estimate || readOnly || !canWrite) return;
    Alert.alert(
      'Применить к плану?',
      `Записать ${formatRub(estimate.grand_total)} в план проекта «${activeProject.name}»? Текущий план: ${formatRub(activeProject.budget_planned)}.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Применить',
          onPress: async () => {
            setApplying(true);
            try {
              await api.patchProject(user.id, activeProject.id, { budget_planned: Math.round(estimate.grand_total) });
              await syncProjectSideEffects({ user, project: activeProject });
              await loadProject(activeProject.id);
              Alert.alert('Готово', 'План проекта обновлён. Смету по работам согласуйте с подрядчиком.');
            } catch {
              Alert.alert('Ошибка', 'Не удалось обновить план проекта');
            } finally {
              setApplying(false);
            }
          },
        },
      ],
    );
  }

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
        {estimate && canWrite && !readOnly && activeProject && (
          <PrimaryButton
            title={applying ? 'Сохраняем…' : `Применить ${formatRub(estimate.grand_total)} к плану проекта`}
            onPress={applyToPlan}
            disabled={applying}
          />
        )}
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
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
  },
});
