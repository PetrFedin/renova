/** Превью плана на неделю — одна строка-сводка + детали по ▼ */
import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { homeRowStyles, homeTypography } from '@/constants/homeTypography';
import { api, CalendarData } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { calendarEventInRange, filterCalendarEventsForRole } from '@/lib/domain/calendarEvents';
import { useOsNavFromHere } from '@/lib/navigation';
import type { OsRole } from '@/constants/osSections';
import { formatCount, RU_NOUN } from '@/lib/i18n';
import {
  useAsyncResource,
  asyncShowError,
  asyncShowStale,
  asyncIsLoading,
  asyncIsRefreshing,
} from '@/lib/async';
import { InlineError, StaleDataBanner, LoadingSkeleton } from '@/components/async';

type DayGroup = { date: string; label: string; count: number; sample: string };
type WeekEvent = { date: string; title: string };

function formatDayLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

function eventLabel(count: number): string {
  return formatCount(count, RU_NOUN.event);
}

type Props = {
  userId: string;
  projectId: string;
  role: OsRole;
  /** Внутри HomeZone — без своего заголовка и обёртки zone */
  embedded?: boolean;
};

export function WeekScheduleStrip({ userId, projectId, role, embedded }: Props) {
  const { pushTab } = useOsNavFromHere(role);
  const [expanded, setExpanded] = useState(false);

  const { resource, data, reload } = useAsyncResource<WeekEvent[]>({
    contextKey: `week-strip:${projectId}:${role}`,
    enabled: Boolean(userId && projectId),
    scope: 'weekScheduleStrip',
    fetcher: async () => {
      const c: CalendarData = await api.getCalendar(userId, projectId);
      const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const to = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      return filterCalendarEventsForRole(c.events, role)
        .filter((e) => calendarEventInRange(e, from, to))
        .map((e) => ({ date: e.date, title: e.title }));
    },
    isEmpty: (d) => d.length === 0,
  });

  const softReload = useCallback(() => {
    void reload({ soft: true });
  }, [reload]);
  useProjectDataReload(softReload);

  const events = data ?? [];
  const groups = useMemo(() => {
    const map = new Map<string, DayGroup>();
    for (const e of events) {
      const g = map.get(e.date) || { date: e.date, label: formatDayLabel(e.date), count: 0, sample: e.title };
      g.count += 1;
      if (!g.sample) g.sample = e.title;
      map.set(e.date, g);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  }, [events]);

  const openCalendar = (date?: string) =>
    pushTab('calendar', undefined, date ? { date } : undefined);

  const wrapStyle = embedded ? undefined : homeRowStyles.zone;
  const head = !embedded ? (
    <View style={homeRowStyles.zoneHead}>
      <Text style={homeTypography.zoneLabel}>План на неделю</Text>
      <Pressable onPress={() => openCalendar()} hitSlop={8} accessibilityRole="button">
        <Text style={homeTypography.link}>Календарь →</Text>
      </Pressable>
    </View>
  ) : null;

  if (asyncIsLoading(resource)) {
    const loading = (
      <>
        {head}
        <LoadingSkeleton rows={1} height={36} />
      </>
    );
    return embedded ? <View>{loading}</View> : <View style={wrapStyle}>{loading}</View>;
  }

  if (asyncShowError(resource)) {
    const err = (
      <>
        {head}
        <InlineError
          error={resource.error}
          title="Не удалось загрузить план"
          onRetry={() => void reload({ soft: false })}
          busy={asyncIsRefreshing(resource)}
        />
      </>
    );
    return embedded ? <View>{err}</View> : <View style={wrapStyle}>{err}</View>;
  }

  if (!groups.length) {
    const empty = (
      <>
        {head}
        {asyncShowStale(resource) ? (
          <StaleDataBanner
            error={resource.error}
            offline={resource.status === 'offline'}
            onRetry={softReload}
            busy={asyncIsRefreshing(resource)}
          />
        ) : null}
        <Pressable style={homeRowStyles.linkRow} onPress={() => openCalendar()} accessibilityRole="button">
          <Text style={[homeTypography.emptyState, homeRowStyles.linkRowLeading]} numberOfLines={1}>
            На этой неделе пусто
          </Text>
        </Pressable>
      </>
    );
    return embedded ? <View>{empty}</View> : <View style={wrapStyle}>{empty}</View>;
  }

  const totalEvents = events.length;
  const summary =
    groups.length === 1
      ? `${groups[0].label} · ${eventLabel(totalEvents)}`
      : eventLabel(totalEvents);

  const body = (
    <>
      {head}
      {asyncShowStale(resource) ? (
        <StaleDataBanner
          error={resource.error}
          offline={resource.status === 'offline'}
          onRetry={softReload}
          busy={asyncIsRefreshing(resource)}
        />
      ) : null}

      <View style={s.summaryRow}>
        <Pressable
          style={s.summaryLink}
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Свернуть расписание' : 'Показать по дням'}
        >
          <Text style={homeTypography.actionRow} numberOfLines={1}>
            {summary} {expanded ? '▲' : '▼'}
          </Text>
        </Pressable>
        {!embedded ? (
          <Pressable
            style={s.calendarArrow}
            onPress={() => openCalendar()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Открыть календарь"
          >
            <Text style={homeTypography.link}>→</Text>
          </Pressable>
        ) : null}
      </View>

      {expanded && groups.map((g) => (
        <Pressable key={g.date} style={s.row} onPress={() => openCalendar(g.date)}>
          <Text style={s.date}>{g.label}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>
              {g.count === 1 ? g.sample : eventLabel(g.count)}
            </Text>
            {g.count > 1 ? <Text style={s.sub} numberOfLines={1}>{g.sample}</Text> : null}
          </View>
        </Pressable>
      ))}
    </>
  );

  return embedded ? <View>{body}</View> : <View style={wrapStyle}>{body}</View>;
}

const s = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryLink: { flex: 1, minWidth: 0, paddingVertical: 6 },
  calendarArrow: { flexShrink: 0, paddingVertical: 6, paddingLeft: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.borderLight,
    gap: 10,
  },
  date: { width: 52, fontSize: 12, color: RenovaTheme.colors.textMuted, fontWeight: '700' },
  title: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
});
