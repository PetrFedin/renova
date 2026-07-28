/** Компактные панели Renova OS для главной */
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { homeLayout, homeTypography } from '@/constants/homeTypography';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import type { ProjectOsSnapshot, ProjectHealthLevel } from '@/lib/domain/osTypes';
import { OsWidgetGrid, OsTwinRow, type OsWidget } from '@/components/renova/os/OsWidgetStrip';
import { HomeKpiDetailSheet } from '@/components/renova/os/home/HomeKpiDetailSheet';
import { useHomeWidgets } from '@/lib/useHomeWidgets';
import type { HomeWidgetId } from '@/constants/homeWidgets';
import { repairTabRoute, type OsRole } from '@/constants/osSections';
import { formatHomeKpiTile } from '@/lib/domain/buildHomeKpiDetail';
import { sanitizeRiskImpact } from '@/lib/domain/sanitizeRiskImpact';
import { workCardStatusLabel, materialPickStatusLabel } from '@/constants/labels';
import { useOsNavFromHere } from '@/lib/navigation';
import { HomeHealthBadge } from '@/components/renova/os/home/HomeHealthBadge';
import { StatusPill } from '@/components/ui/StatusPill';
import type { ProjectHeaderMeta } from '@/lib/domain/resolveProjectPhase';

export function ProjectOsHeader({
  name,
  headerMeta,
  healthScore,
  healthLevel,
  healthLabel,
  showHealth,
}: {
  name: string;
  headerMeta: ProjectHeaderMeta;
  healthScore?: number;
  healthLevel?: ProjectHealthLevel;
  healthLabel?: string;
  showHealth?: boolean;
  /** @deprecated Имя всегда показывается на главной */
  nameHidden?: boolean;
  status?: string;
}) {
  const showCompleteBadge = Boolean(headerMeta.status);

  return (
    <View style={s.header}>
      <View style={s.identityCard}>
        <View style={s.titleRow}>
          <Text style={s.projectName} numberOfLines={2}>{name}</Text>
          {showCompleteBadge ? (
            <View style={s.completeBadge}>
              <StatusPill label="Завершён" tone="success" />
            </View>
          ) : null}
        </View>
        <Text style={s.projectMeta} numberOfLines={2}>{headerMeta.context}</Text>
        {showHealth && healthScore != null && healthLevel && healthLabel ? (
          <View style={s.healthWrap}>
            <HomeHealthBadge score={healthScore} level={healthLevel} label={healthLabel} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function OsKpiGrid({ snap, rolePrefix, role, gridTitle }: { snap: ProjectOsSnapshot; rolePrefix: string; role: OsRole; gridTitle?: string | null }) {
  return <OsKpiStrip snap={snap} rolePrefix={rolePrefix} role={role} gridTitle={gridTitle} />;
}

/** KPI — сетка 2 в строке, фильтр из настроек профиля */
export function OsKpiStrip({ snap, rolePrefix, role, gridTitle }: { snap: ProjectOsSnapshot; rolePrefix: string; role: OsRole; gridTitle?: string | null }) {
  const { isVisible } = useHomeWidgets(role);
  const [detailWidgetId, setDetailWidgetId] = useState<string | null>(null);

  const widgetIds: HomeWidgetId[] = ['kpi_budget', 'kpi_schedule', 'kpi_materials', 'kpi_quality'];
  const items: OsWidget[] = widgetIds
    .filter((id) => {
      if (!isVisible(id)) return false;
      if (id === 'kpi_materials' && snap.materials.needBuy <= 0) return false;
      if (id === 'kpi_quality' && snap.quality.awaitingAcceptance <= 0) return false;
      if (id === 'kpi_quality' && snap.nextAction?.kind === 'accept') return false;
      if (id === 'kpi_budget' && snap.nextAction?.kind === 'payment') return false;
      return true;
    })
    .map((id) => {
      const tile = formatHomeKpiTile(id, snap);
      return { id, label: tile.label, value: tile.value, hint: tile.hint };
    });

  if (!items.length) return null;
  return (
    <>
      <OsWidgetGrid
        items={items}
        title={gridTitle === null ? undefined : (gridTitle ?? 'Сводка')}
        role={role}
        onWidgetPress={(it) => setDetailWidgetId(it.id)}
      />
      <HomeKpiDetailSheet
        widgetId={detailWidgetId}
        snap={snap}
        role={role}
        onClose={() => setDetailWidgetId(null)}
      />
    </>
  );
}

export function RiskStrip({ snap, role }: { snap: ProjectOsSnapshot; role: OsRole }) {
  const { pushNav } = useOsNavFromHere(role);
  const hero = snap.nextAction?.kind;
  const risks = snap.risks.filter((r) => {
    if (hero === 'accept' && (r.kind === 'quality' || /приём/i.test(r.title))) return false;
    if (hero === 'work' && (r.kind === 'schedule' || /просроч/i.test(r.title))) return false;
    return true;
  });
  if (!risks.length) return null;
  return (
    <View style={s.risks}>
      <Text style={homeTypography.zoneLabel}>Риски</Text>
      {risks.map((r) => (
        <Pressable key={r.id} style={s.riskRow} onPress={() => pushNav(r.href)}>
          <Text style={s.riskTitle} numberOfLines={1}>{r.title}</Text>
          <Text style={s.riskSub} numberOfLines={2}>
            {sanitizeRiskImpact(r.impact, snap.budget.planned)}{r.action ? ` · ${r.action}` : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function CompactWorksList({ snap, role }: { snap: ProjectOsSnapshot; role: OsRole }) {
  const { pushNav } = useOsNavFromHere(role);
  if (!snap.activeWorks.length) return null;
  return (
    <View style={s.compactList}>
      <Text style={s.section}>Текущие работы</Text>
      {snap.activeWorks.slice(0, 3).map((w) => (
        <Pressable key={w.id} style={s.listRowSm} onPress={() => pushNav(w.href)}>
          <Text style={s.rowTitle} numberOfLines={1}>{w.name}</Text>
          <Text style={s.rowMeta} numberOfLines={1}>{w.room || '—'} · {workCardStatusLabel(w.status)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Работы и материалы — только если есть именованные пункты, не дублируя пустой KPI */
export function WorksMaterialsTwinRow({ snap, role }: { snap: ProjectOsSnapshot; role: OsRole }) {
  const { pushNav } = useOsNavFromHere(role);
  const hero = snap.nextAction?.kind;
  const works = snap.activeWorks
    .filter((w) => !(hero === 'accept' && /приём/i.test(w.status)))
    .slice(0, 2);
  const materials = hero === 'material'
    ? []
    : snap.materialNeeds.slice(0, 2);
  if (!works.length && !materials.length) return null;

  return (
    <OsTwinRow
      left={works.length ? (
        <View style={s.compactList}>
          <Text style={[homeTypography.zoneLabel, s.sectionSm]}>Работы</Text>
          {works.map((w) => (
            <Pressable key={w.id} style={s.listRowSm} onPress={() => pushNav(w.href)}>
              <Text style={s.rowTitleSm} numberOfLines={1}>{w.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : <View />}
      right={materials.length ? (
        <View style={s.compactList}>
          <Text style={[homeTypography.zoneLabel, s.sectionSm]}>Материалы</Text>
          {materials.map((m) => (
            <Pressable key={m.id} style={s.listRowSm} onPress={() => pushNav(m.href)}>
              <Text style={s.rowTitleSm} numberOfLines={1}>{m.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : <View />}
    />
  );
}

export function CompactMaterialsList({ snap, role }: { snap: ProjectOsSnapshot; role: OsRole }) {
  const { pushNav } = useOsNavFromHere(role);
  if (!snap.materialNeeds.length) return null;
  return (
    <View>
      <Text style={s.section}>Материалы</Text>
      {snap.materialNeeds.map((m) => (
        <Pressable key={m.id} style={s.listRow} onPress={() => pushNav(m.href)}>
          <Text style={s.rowTitle} numberOfLines={1}>{m.name}</Text>
          <Text style={s.rowMeta}>{m.room || '—'} · {materialPickStatusLabel(m.status)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  /** Clarity W: flat identity — без card, один elevated surface остаётся у HomeActionHero */
  header: { marginBottom: homeLayout.sectionGap + 4 },
  identityCard: {
    paddingVertical: 8,
    paddingHorizontal: 2,
    gap: 6,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  projectName: {
    flex: 1,
    minWidth: 0,
    ...screenTypography.listTitle,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  projectMeta: {
    ...screenTypography.listMeta,
    fontWeight: '500',
  },
  completeBadge: { flexShrink: 0, marginTop: 2 },
  healthWrap: { marginTop: 2 },
  /** Clarity K: sentence-case секции + list-row вместо card-стека */
  section: { ...screenTypography.section, marginBottom: 8, marginTop: 4 },
  risks: { marginBottom: homeLayout.innerGap },
  riskRow: {
    ...listRowStyles.row,
    borderLeftWidth: 3,
    borderLeftColor: RenovaTheme.colors.warning,
    paddingLeft: 10,
  },
  riskTitle: { ...screenTypography.listTitle, fontSize: 14 },
  riskSub: { ...screenTypography.listMeta },
  listRow: { ...listRowStyles.row },
  listRowSm: { paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RenovaTheme.colors.border },
  compactList: { ...listRowStyles.metricCell, alignItems: 'stretch', flex: 1, marginBottom: 0, padding: 10 },
  sectionSm: { ...screenTypography.section, marginBottom: 4, marginTop: 0 },
  rowTitleSm: { ...screenTypography.listTitle, fontSize: 13 },
  rowTitle: { ...screenTypography.listTitle },
  rowMeta: { ...screenTypography.listMeta },
});
