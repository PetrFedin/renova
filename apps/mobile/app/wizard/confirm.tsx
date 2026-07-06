import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { calcRoomMetrics, generateTemplateLines, calcEstimateSummary } from '@/lib/calc-engine';
import { resolveRenovationType, roomTypeLabel } from '@/constants/roomTypes';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { BudgetPlannerPanel } from '@/components/renova/BudgetPlannerPanel';
import { MarketEstimateInsightCard } from '@/components/renova/wizard/MarketEstimateInsightCard';
import { RenovationPlanBadge } from '@/components/renova/RenovationPlanBadge';
import { CustomerBudgetField } from '@/components/renova/CustomerBudgetField';
import { PostCreateSheet } from '@/components/renova/os/home/PostCreateSheet';
import { ContractorInviteSheet } from '@/components/renova/os/home/ContractorInviteSheet';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import type { MarketEstimate } from '@/constants/regions';
import { buildMarketEstimateInsights } from '@/lib/wizard/buildMarketEstimateInsights';
import { quickWizardFloorSqM } from '@/lib/wizard/buildQuickWizardRooms';
import { WizardHint } from '@/components/renova/wizard/WizardHint';

function formatCreateError(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { message?: string; detail?: string | { msg?: string }[]; status?: number };
    if (typeof err.detail === 'string' && err.detail) return err.detail;
    if (Array.isArray(err.detail)) return err.detail.map((d) => d.msg || String(d)).join('\n');
    if (err.message && err.message !== 'offline_queued') return err.message;
    if (err.status) return `Ошибка сервера (${err.status})`;
  }
  return __DEV__
    ? 'Сервер недоступен. Проверьте подключение к backend.'
    : 'Не удалось создать объект. Проверьте интернет и попробуйте снова.';
}

export default function WizardConfirm() {
  const { user, wizard, createProjectFromWizard, loadProject, activeProject } = useRenova();
  const [busy, setBusy] = useState(false);
  const [regionCode, setRegionCode] = useState('moscow');
  const [planTypes, setPlanTypes] = useState<string[]>(['painting']);
  const [complexity, setComplexity] = useState(1);
  const [laborShare, setLaborShare] = useState(0.5);
  const [marketEstimate, setMarketEstimate] = useState<MarketEstimate | null>(null);
  const [applyMarketPlan, setApplyMarketPlan] = useState(true);
  const [budgetInput, setBudgetInput] = useState(
    wizard.customer_budget ? String(wizard.customer_budget) : '',
  );
  const [postCreateOpen, setPostCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createdName, setCreatedName] = useState('');
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  let materials: any[] = [];
  let works: any[] = [];
  wizard.rooms.forEach((room, i) => {
    const id = `tmp-${i}`;
    const m = calcRoomMetrics({ lengthM: room.length_m, widthM: room.width_m, heightM: room.height_m, openingsSqM: 2 });
    const eff = resolveRenovationType(wizard.renovation_type, room.room_type) as any;
    const lines = generateTemplateLines(eff, id, m);
    materials = materials.concat(lines.materials);
    works = works.concat(lines.works);
  });
  const summary = calcEstimateSummary(materials, works);

  const plannerMetrics = useMemo(() => ({
    floor_sq_m: quickWizardFloorSqM(wizard.rooms) || 12,
    wall_sq_m: wizard.rooms.length * 24,
    perimeter_m: 14,
    outlets_count: wizard.rooms.reduce((a, r) => a + (r.outlets_count || 0), 0),
    plumbing_points: wizard.rooms.reduce((a, r) => a + (r.plumbing_points || 0), 0),
  }), [wizard.rooms]);

  const marketInsights = useMemo(
    () => buildMarketEstimateInsights(summary.grandTotal, marketEstimate),
    [summary.grandTotal, marketEstimate],
  );

  async function onCreate() {
    if (!wizard.name.trim()) {
      Alert.alert('Укажите название проекта');
      return;
    }
    const budgetNum = parseInt(budgetInput.replace(/\s/g, ''), 10);
    setBusy(true);
    try {
      const result = await createProjectFromWizard({
        customer_budget: budgetNum > 0 ? budgetNum : undefined,
      });
      setCreatedProjectId(result.id);
      if (applyMarketPlan && marketEstimate && user) {
        await api.patchProject(user.id, result.id, { budget_planned: Math.round(marketEstimate.grand_total) });
        await loadProject(result.id);
      }
      setCreatedName(wizard.name.trim());
      if (result.demoKeptPrimary && __DEV__) {
        const { createdName: cn, activeName } = result.demoKeptPrimary;
        Alert.alert(
          'Объект создан',
          `«${cn}» добавлен в список. На демо открыт «${activeName}» — переключите объект в шапке.`,
        );
      }
      setPostCreateOpen(true);
    } catch (e) {
      const msg = formatCreateError(e);
      Alert.alert('Ошибка создания', msg, [
        { text: 'Повторить', onPress: () => { onCreate().catch(() => {}); } },
        { text: 'OK', style: 'cancel' },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.stepTitle}>
          {wizard.wizard_mode === 'quick' ? 'Быстрая смета' : 'Шаг 3 · Смета и бюджет'}
        </Text>
        <Text style={styles.total}>{formatRub(summary.grandTotal)}</Text>
        <Text style={styles.subLabel}>План из сметы (шаблон)</Text>
        <WizardHint
        brief="Проверьте сумму и сроки — потом пригласите исполнителя."
        detailed="Смета по шаблону — черновик. Уточните комнаты позже для точности. Рыночный диапазон ниже — ориентир, не договор."
      />
      <RenovationPlanBadge renovationType={wizard.renovation_type} propertyType={wizard.property_type} />
        <Text style={styles.sub}>
          {wizard.property_type === 'house' ? 'Дом' : 'Квартира'} · {wizard.rooms.length} комн. · работы {formatRub(summary.worksTotal)} · материалы {formatRub(summary.materialsTotal)}
        </Text>
        {wizard.rooms.map((r, i) => (
          <Text key={i} style={styles.roomLine}>· {r.name} ({roomTypeLabel(r.room_type)}{r.floor_level && r.floor_level > 1 ? `, ${r.floor_level} эт.` : ''}) — {r.length_m}×{r.width_m} м</Text>
        ))}

        <CustomerBudgetField
          value={budgetInput}
          onChange={setBudgetInput}
          estimateTotal={summary.grandTotal}
          hint="Укажите, сколько готовы вложить. Приложение будет контролировать факт и перерасход относительно этого лимита."
        />

        <Text style={styles.sectionHead}>Рыночная оценка</Text>
        <BudgetPlannerPanel
          workTypes={planTypes}
          onWorkTypesChange={setPlanTypes}
          regionCode={regionCode}
          onRegionChange={setRegionCode}
          metrics={plannerMetrics}
          complexity={complexity}
          onComplexityChange={setComplexity}
          laborShare={laborShare}
          onLaborShareChange={setLaborShare}
          onEstimate={(est) => {
            setMarketEstimate(est);
            if (est.grand_total > summary.grandTotal * 1.12) setApplyMarketPlan(true);
          }}
          compact
        />

        {marketInsights ? <MarketEstimateInsightCard insights={marketInsights} /> : null}

        {marketEstimate ? (
          <Pressable style={styles.toggleRow} onPress={() => setApplyMarketPlan((v) => !v)}>
            <Text style={styles.toggleMark}>{applyMarketPlan ? '☑' : '☐'}</Text>
            <Text style={styles.toggleText}>
              Записать рыночную оценку {formatRub(marketEstimate.grand_total)} в план сметы (шаблон {formatRub(summary.grandTotal)})
            </Text>
          </Pressable>
        ) : null}

        <Text style={styles.note}>После создания: контроль бюджета на главной и в «Деньги». Комнаты можно уточнить в «Квартира».</Text>
        <PrimaryButton title={busy ? 'Создание…' : 'Создать проект'} onPress={onCreate} disabled={busy} />
      </ScrollView>

      <PostCreateSheet
        visible={postCreateOpen}
        projectName={createdName || wizard.name}
        onNavigate={(href, stepId) => {
          if (stepId === 'contractor') {
            setPostCreateOpen(false);
            setInviteOpen(true);
            return;
          }
          setPostCreateOpen(false);
          router.replace(href as any);
        }}
        onHome={() => {
          setPostCreateOpen(false);
          router.replace('/(customer)/(tabs)');
        }}
        onClose={() => {
          setPostCreateOpen(false);
          router.replace('/(customer)/(tabs)');
        }}
      />

      {user && createdProjectId ? (
        <ContractorInviteSheet
          visible={inviteOpen}
          userId={user.id}
          projectId={createdProjectId}
          projectName={createdName || wizard.name}
          linkedContractorId={activeProject?.contractor_id}
          onClose={() => {
            setInviteOpen(false);
            router.replace('/(customer)/(tabs)');
          }}
          onLinked={() => loadProject(createdProjectId).catch(() => {})}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  stepTitle: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  sectionHead: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text, marginTop: 16, marginBottom: 8 },
  total: { fontSize: 36, fontWeight: '800', color: RenovaTheme.colors.primary },
  subLabel: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  sub: { color: RenovaTheme.colors.textMuted, marginTop: 8 },
  roomLine: { fontSize: 13, marginTop: 4, color: RenovaTheme.colors.text },
  note: { marginVertical: 16, color: RenovaTheme.colors.text, lineHeight: 22, fontSize: 13 },
  toggleRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 16, padding: 12, backgroundColor: RenovaTheme.colors.infoBg, borderRadius: 10 },
  toggleMark: { fontSize: 18, lineHeight: 22 },
  toggleText: { flex: 1, fontSize: 13, lineHeight: 18, color: RenovaTheme.colors.text },
});
