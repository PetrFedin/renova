/** Площадки (этажи/зоны) и циклы работ внутри проекта */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { buildProjectSites } from '@/lib/domain/projectSites';
import type { ProjectDetail, ReceiptItem, MaterialPick } from '@/lib/api';
import { objectTabRoute, type OsRole } from '@/constants/osSections';
import { OsWidgetGrid, type OsWidget } from '@/components/renova/os/OsWidgetStrip';

export function ProjectSitesPanel({
  project,
  receipts = [],
  picks = [],
  compact,
  role = 'customer',
  returnTo,
}: {
  project: ProjectDetail;
  receipts?: ReceiptItem[];
  picks?: MaterialPick[];
  compact?: boolean;
  role?: OsRole;
  returnTo?: string;
}) {
  const sites = buildProjectSites(project, receipts, picks);
  if (sites.length <= 1 && compact) return null;

  const widgets: OsWidget[] = sites.map((site) => ({
    id: site.id,
    label: site.label,
    value: formatRub(site.spent),
    hint: `${site.progressPercent}% · ${site.stages.length} этап.`,
    width: 118,
    href: objectTabRoute(role, 'rooms'),
  }));

  return (
    <View style={s.wrap}>
      <View style={s.headRow}>
        <Text style={s.title}>Площадки · циклы</Text>
      </View>
      <OsWidgetGrid items={widgets} returnTo={returnTo} />
      {!compact && sites.map((site) => (
        <View key={site.id} style={s.site}>
          <View style={s.siteHead}>
            <Text style={s.siteName}>{site.label}</Text>
            <Text style={s.siteAmt}>{formatRub(site.spent)}{site.plan ? ` / ${formatRub(site.plan)}` : ''}</Text>
          </View>
          <Text style={s.siteMeta}>{site.rooms.length} комн. · {site.stages.length} этапов · {site.progressPercent}%</Text>
          {site.stages.slice(0, 4).map((st) => (
            <View key={st.id} style={s.stageRow}>
              <Text style={s.stageName} numberOfLines={1}>{st.name}</Text>
              <Text style={s.stageSt}>{st.display_status || st.status}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 10 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  site: { ...card, padding: 10, marginBottom: 8 },
  siteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  siteName: { fontSize: 15, fontWeight: '700', flex: 1, color: RenovaTheme.colors.text },
  siteAmt: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary },
  siteMeta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 4, marginBottom: 6 },
  stageRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  stageName: { fontSize: 12, flex: 1, color: RenovaTheme.colors.text },
  stageSt: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginLeft: 8 },
});
