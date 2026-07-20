/** История решений — смета, сроки, согласования (поверх activity API) */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { api } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import {
  buildDecisionHistory,
  DECISION_FILTER_CHIPS,
  filterDecisionHistory,
  type DecisionCategory,
  type DecisionHistoryItem,
} from '@/lib/domain/buildDecisionHistory';
import { resolvePushLink } from '@/lib/pushLinks';
import { useRenova } from '@/lib/context/RenovaContext';
import type { OsRole } from '@/constants/osSections';

type Props = {
  userId: string;
  projectId: string;
  stageId?: string;
  compact?: boolean;
  limit?: number;
  returnTo?: string;
  showFilters?: boolean;
};

export function DecisionHistoryPanel({
  userId,
  projectId,
  stageId,
  compact,
  limit = compact ? 5 : 30,
  returnTo,
  showFilters = !compact,
}: Props) {
  const [raw, setRaw] = useState<DecisionHistoryItem[]>([]);
  const [filter, setFilter] = useState<DecisionCategory | 'all'>('all');
  const back = returnTo || '/';

  const reload = useCallback(() => {
    api
      .activityFeed(userId, projectId)
      .then((items) => setRaw(buildDecisionHistory(items, { stageId, limit: 100 })))
      .catch(() => setRaw([]));
  }, [userId, projectId, stageId]);

  useEffect(() => {
    reload();
  }, [reload]);
  useProjectDataReload(reload);

  const visible = useMemo(() => {
    const filtered = filterDecisionHistory(raw, filter);
    return compact ? filtered.slice(0, limit) : filtered.slice(0, limit);
  }, [raw, filter, compact, limit]);

  const { user } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';

  const openItem = (item: DecisionHistoryItem) => {
    if (!item.linkPath) return;
    const target = resolvePushLink(item.linkPath, back, role);
    if (!target) return;
    router.push({ pathname: target.pathname, params: target.params } as any);
  };

  return (
    <View style={s.wrap}>
      <Text style={s.head}>{compact ? 'Недавние решения' : 'История решений'}</Text>
      {!compact && (
        <Text style={s.sub}>
          Кто изменил смету, перенёс срок или согласовал доп. работы — по данным архива проекта.
        </Text>
      )}

      {showFilters && raw.length > 3 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips}>
          {DECISION_FILTER_CHIPS.map((c) => (
            <Pressable
              key={c.key}
              style={[s.chip, filter === c.key && s.chipOn]}
              onPress={() => setFilter(c.key)}
            >
              <Text style={[s.chipT, filter === c.key && s.chipTOn]}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {!visible.length ? (
        <Text style={s.empty}>
          {stageId ? 'По этому этапу решений пока нет' : 'Решений по фильтру пока нет — они появятся после согласований и изменений'}
        </Text>
      ) : (
        visible.map((item) => (
          <Pressable
            key={item.id}
            style={s.row}
            onPress={() => openItem(item)}
            disabled={!item.linkPath}
          >
            <View style={s.badge}>
              <Text style={s.badgeT}>{item.categoryLabel}</Text>
            </View>
            <View style={s.main}>
              <Text style={s.title}>{item.title}</Text>
              {item.body ? <Text style={s.body} numberOfLines={2}>{item.body}</Text> : null}
              <Text style={s.meta}>
                {item.actorHint ? `${item.actorHint} · ` : ''}
                {item.at.slice(0, 16).replace('T', ' ')}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginVertical: 8 },
  head: { fontWeight: '800', fontSize: 15, marginBottom: 4 },
  sub: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 8 },
  chips: { marginBottom: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: RenovaTheme.colors.border,
    marginRight: 6,
  },
  chipOn: { backgroundColor: RenovaTheme.colors.infoBg, borderWidth: 1, borderColor: RenovaTheme.colors.accent },
  chipT: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  chipTOn: { color: RenovaTheme.colors.accent },
  row: {
    ...card,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    marginBottom: 6,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeT: { fontSize: 10, fontWeight: '800', color: '#1D4ED8', textTransform: 'uppercase' },
  main: { flex: 1, minWidth: 0 },
  title: { fontWeight: '600', fontSize: 13 },
  body: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  meta: { fontSize: 10, color: '#999', marginTop: 4 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, fontStyle: 'italic', lineHeight: 18 },
});
