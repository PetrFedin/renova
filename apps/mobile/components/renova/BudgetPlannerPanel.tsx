/** Планировщик бюджета: работа / материалы / срок / рынок / Лемана ПРО */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView, Linking } from 'react-native';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { WORK_TYPES_FALLBACK, WORK_CATEGORY_LABEL, groupWorkTypes } from '@/constants/workCatalog';
import { REGIONS_FALLBACK, fallbackMarketEstimate, type MarketEstimate, type MarketConsumable } from '@/constants/regions';
import { api } from '@/lib/api';

type Props = {
  workTypes: string[];
  onWorkTypesChange: (types: string[]) => void;
  regionCode: string;
  onRegionChange: (code: string) => void;
  metrics: {
    floor_sq_m: number;
    wall_sq_m: number;
    perimeter_m: number;
    outlets_count?: number;
    plumbing_points?: number;
  };
  onMetricsChange?: (m: Props['metrics']) => void;
  complexity: number;
  onComplexityChange: (v: number) => void;
  laborShare: number;
  onLaborShareChange: (v: number) => void;
  onEstimate?: (est: MarketEstimate) => void;
  /** Редактируемый список материалов (заказчик меняет цену / ссылку) */
  materials?: MarketConsumable[];
  onMaterialsChange?: (items: MarketConsumable[]) => void;
  compact?: boolean;
};

export function BudgetPlannerPanel({
  workTypes, onWorkTypesChange, regionCode, onRegionChange, metrics, onMetricsChange,
  complexity, onComplexityChange, laborShare, onLaborShareChange, onEstimate,
  materials, onMaterialsChange, compact,
}: Props) {
  const [regions, setRegions] = useState(REGIONS_FALLBACK);
  const [types, setTypes] = useState(WORK_TYPES_FALLBACK);
  const [est, setEst] = useState<MarketEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [localMaterials, setLocalMaterials] = useState<MarketConsumable[]>(materials || []);

  useEffect(() => { api.listMarketRegions().then(setRegions).catch(() => {}); api.listWorkTypes().then(setTypes).catch(() => {}); }, []);
  useEffect(() => { if (materials) setLocalMaterials(materials); }, [materials]);

  const payload = useMemo(() => ({
    region_code: regionCode,
    work_types: workTypes.length ? workTypes : ['custom'],
    floor_sq_m: metrics.floor_sq_m,
    wall_sq_m: metrics.wall_sq_m,
    perimeter_m: metrics.perimeter_m,
    outlets_count: metrics.outlets_count || 0,
    plumbing_points: metrics.plumbing_points || 0,
    complexity,
    labor_share: laborShare,
  }), [regionCode, workTypes, metrics, complexity, laborShare]);

  const recalc = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.marketEstimate(payload);
      setEst(r);
      const merged = [...(r.consumables || []), ...(localMaterials.filter((m) => !r.consumables?.some((c) => c.name === m.name)))];
      setLocalMaterials(merged);
      onMaterialsChange?.(merged);
      onEstimate?.(r);
    } catch {
      const fb = fallbackMarketEstimate(payload);
      setEst(fb);
      onEstimate?.(fb);
    } finally {
      setLoading(false);
    }
  }, [payload, onEstimate, onMaterialsChange, localMaterials]);

  useEffect(() => { if (workTypes.length) recalc(); }, [regionCode, workTypes.join(','), complexity, laborShare, metrics.floor_sq_m]);

  const groups = useMemo(() => groupWorkTypes(types), [types]);

  const toggleType = (code: string) => {
    const next = workTypes.includes(code) ? workTypes.filter((t) => t !== code) : [...workTypes, code];
    onWorkTypesChange(next);
  };

  const updateMaterial = (idx: number, patch: Partial<MarketConsumable>) => {
    const next = localMaterials.map((m, i) => (i === idx ? { ...m, ...patch, total: (patch.estimated_price ?? m.estimated_price) * (patch.qty ?? m.qty) } : m));
    setLocalMaterials(next);
    onMaterialsChange?.(next);
  };

  const matTotal = localMaterials.reduce((a, m) => a + (m.total || m.qty * m.estimated_price), 0);

  return (
    <View style={s.wrap}>
      {!compact && (
        <>
          <Text style={s.head}>Примерный бюджет по рынку</Text>
          <Text style={s.refHint}>Справочно — не сохраняется в проект, пока вы не нажмёте «Применить к плану» на экране планировщика.</Text>
        </>
      )}

      <Text style={s.label}>Регион</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {regions.map((r) => (
          <Pressable key={r.code} style={[s.chip, regionCode === r.code && s.chipOn]} onPress={() => onRegionChange(r.code)}>
            <Text style={[s.chipT, regionCode === r.code && s.chipTOn]}>{r.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={s.label}>Типы работ</Text>
      {groups.map((g) => (
        <View key={g.category} style={{ marginBottom: 6 }}>
          <Text style={s.cat}>{g.label}</Text>
          <View style={s.chips}>
            {g.items.map((t) => (
              <Pressable key={t.code} style={[s.chip, workTypes.includes(t.code) && s.chipOn]} onPress={() => toggleType(t.code)}>
                <Text style={[s.chipT, workTypes.includes(t.code) && s.chipTOn]}>{t.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      {onMetricsChange && (
        <>
          <Text style={s.label}>Габариты (м² / м)</Text>
          <View style={s.row}>
            <TextInput style={[s.input, { flex: 1 }]} keyboardType="numeric" value={String(metrics.floor_sq_m)} onChangeText={(v) => onMetricsChange({ ...metrics, floor_sq_m: +v || 0 })} placeholder="Пол" />
            <TextInput style={[s.input, { flex: 1 }]} keyboardType="numeric" value={String(metrics.wall_sq_m)} onChangeText={(v) => onMetricsChange({ ...metrics, wall_sq_m: +v || 0 })} placeholder="Стены" />
          </View>
        </>
      )}

      <Text style={s.label}>Сложность: {complexity.toFixed(1)}×</Text>
      <View style={s.row}>
        {[0.8, 1.0, 1.2, 1.5].map((v) => (
          <Pressable key={v} style={[s.chip, complexity === v && s.chipOn]} onPress={() => onComplexityChange(v)}>
            <Text style={[s.chipT, complexity === v && s.chipTOn]}>{v}×</Text>
          </Pressable>
        ))}
      </View>

      <Text style={s.label}>Доля работ: {Math.round(laborShare * 100)}% · материалы: {Math.round((1 - laborShare) * 100)}%</Text>
      <View style={s.row}>
        {[0.35, 0.5, 0.65].map((v) => (
          <Pressable key={v} style={[s.chip, laborShare === v && s.chipOn]} onPress={() => onLaborShareChange(v)}>
            <Text style={[s.chipT, laborShare === v && s.chipTOn]}>{Math.round(v * 100)}/{Math.round((1 - v) * 100)}</Text>
          </Pressable>
        ))}
      </View>

      <PrimaryButton title={loading ? 'Считаем…' : 'Пересчитать'} variant="outline" compact onPress={recalc} />

      {est && (
        <View style={s.summary}>
          <Text style={s.total}>{formatRub(est.grand_total)}</Text>
          <Text style={s.sub}>ориентир · ~{est.days_estimated} раб. дней · резерв {formatRub(est.reserve)} · не в учёт проекта</Text>
          <View style={s.splitRow}>
            <View style={[s.split, { flex: est.labor_share }]}><Text style={s.splitT}>Работы</Text><Text style={s.splitV}>{formatRub(est.labor_total)}</Text></View>
            <View style={[s.split, s.splitMat, { flex: est.materials_share }]}><Text style={s.splitT}>Материалы</Text><Text style={s.splitV}>{formatRub(est.materials_total)}</Text></View>
          </View>

          {est.price_trend_6m.length > 0 && (
            <>
              <Text style={s.section}>Динамика за 6 мес.</Text>
              {est.price_trend_6m.map((p) => (
                <View key={p.month} style={s.trendRow}>
                  <Text style={s.trendLabel}>{p.label}</Text>
                  <View style={s.trendBarWrap}><View style={[s.trendBar, { width: `${Math.min(100, p.index)}%` }]} /></View>
                  <Text style={s.trendVal}>{formatRub(p.total)}</Text>
                </View>
              ))}
              <Text style={s.hint}>{est.disclaimer}</Text>
            </>
          )}

          {est.lemana_suggestions.length > 0 && (
            <>
              <Text style={s.section}>Лемана ПРО — примерные позиции</Text>
              {est.lemana_suggestions.map((l) => (
                <Pressable key={l.name} style={s.lemana} onPress={() => Linking.openURL(l.shop_url)}>
                  <Text style={s.lemanaName}>{l.name}</Text>
                  <Text style={s.lemanaMeta}>~{formatRub(l.avg_price)}/{l.unit} · открыть в каталоге →</Text>
                </Pressable>
              ))}
            </>
          )}

          {localMaterials.length > 0 && (
            <>
              <Text style={s.section}>Расходники и материалы ({formatRub(matTotal)})</Text>
              {localMaterials.map((m, i) => (
                <View key={`${m.name}-${i}`} style={s.matRow}>
                  <Text style={s.matName}>{m.name} · {m.qty} {m.unit}</Text>
                  <TextInput
                    style={s.priceInput}
                    keyboardType="numeric"
                    value={String(m.estimated_price)}
                    onChangeText={(v) => updateMaterial(i, { estimated_price: +v || 0, total: (+v || 0) * m.qty })}
                  />
                </View>
              ))}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginVertical: 8 },
  head: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  refHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, lineHeight: 15, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginTop: 10, marginBottom: 6 },
  cat: { fontSize: 10, color: RenovaTheme.colors.textMuted, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: RenovaTheme.colors.border, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  chipOn: { backgroundColor: RenovaTheme.colors.infoBg, borderColor: RenovaTheme.colors.accent },
  chipT: { fontSize: 12, fontWeight: '600' },
  chipTOn: { color: RenovaTheme.colors.accent },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  input: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 8, backgroundColor: RenovaTheme.colors.surface },
  summary: { ...card, marginTop: 12 },
  total: { fontSize: 28, fontWeight: '800', color: RenovaTheme.colors.primary },
  sub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  splitRow: { flexDirection: 'row', marginTop: 12, gap: 4, height: 48 },
  split: { backgroundColor: '#DBEAFE', borderRadius: 8, padding: 8, justifyContent: 'center' },
  splitMat: { backgroundColor: '#FEF3C7' },
  splitT: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.textMuted },
  splitV: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  section: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  trendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  trendLabel: { width: 72, fontSize: 10, color: RenovaTheme.colors.textMuted },
  trendBarWrap: { flex: 1, height: 8, backgroundColor: RenovaTheme.colors.border, borderRadius: 4, overflow: 'hidden' },
  trendBar: { height: 8, backgroundColor: RenovaTheme.colors.accent },
  trendVal: { width: 72, fontSize: 10, fontWeight: '600', textAlign: 'right' },
  hint: { fontSize: 10, color: RenovaTheme.colors.textMuted, marginTop: 6, lineHeight: 14 },
  lemana: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  lemanaName: { fontWeight: '600', fontSize: 13 },
  lemanaMeta: { fontSize: 11, color: RenovaTheme.colors.accent, marginTop: 2 },
  matRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  matName: { flex: 1, fontSize: 12 },
  priceInput: { width: 72, borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 6, padding: 6, textAlign: 'right' },
});
