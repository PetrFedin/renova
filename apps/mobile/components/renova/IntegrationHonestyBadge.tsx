/** Честный статус интеграций на Home — свёрнут, раскрывается по тапу (не 4 chips всегда). */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { API_BASE_GUARD } from '@/lib/api/client';
import { useInboxWsConnected } from '@/lib/useChatUnread';
import { reportError } from '@/lib/reportError';

type Chip = { id: string; label: string; ok: boolean };
type Probe<T> = { value: T | null; failed: boolean };

async function probe<T>(scope: string, request: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { value: await request(), failed: false };
  } catch (error) {
    reportError(scope, error);
    return { value: null, failed: true };
  }
}

export function IntegrationHonestyBadge() {
  const { user } = useRenova();
  const inboxWsConnected = useInboxWsConnected();
  const [chips, setChips] = useState<Chip[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    (async () => {
      const [yProbe, fProbe, eProbe, h0Probe] = await Promise.all([
        probe('integrationHealth.yookassa', () => api.getYookassaHealth(user.id)),
        probe('integrationHealth.fns', () => api.getFnsHealth(user.id)),
        probe('integrationHealth.esign', () => api.getEsignHealth(user.id)),
        user.role === 'contractor'
          ? probe('integrationHealth.h0', () => api.getH0Readiness(user.id))
          : Promise.resolve({ value: null, failed: false }),
      ]);
      if (!alive) return;

      const y = yProbe.value;
      const f = fProbe.value;
      const e = eProbe.value;
      const h0 = h0Probe.value;
      const yLive = Boolean(
        y &&
          ((y as { live_checkout_ready?: boolean }).live_checkout_ready ||
            (y as { configured?: boolean }).configured),
      );
      const fLive = Boolean((f as { live_verify_ready?: boolean } | null)?.live_verify_ready);
      const providers = (e as { providers?: { available?: boolean }[] } | null)?.providers;
      const eLive = Boolean(providers?.some((p) => p?.available));

      const next: Chip[] = [
        {
          id: 'pay',
          label: yProbe.failed ? 'ЮKassa: status unknown' : yLive ? 'ЮKassa: live' : 'ЮKassa: demo/off',
          ok: !yProbe.failed && yLive,
        },
        {
          id: 'fns',
          label: fProbe.failed ? 'ФНС: status unknown' : fLive ? 'ФНС: live' : 'ФНС: offline',
          ok: !fProbe.failed && fLive,
        },
        {
          id: 'sign',
          label: eProbe.failed ? 'Подпись: status unknown' : eLive ? 'Kontur: on' : 'Подпись: in_app',
          ok: !eProbe.failed && eLive,
        },
        // Investor P1: WS inbox — иначе polling и ложное «realtime»
        {
          id: 'ws',
          label: inboxWsConnected ? 'Inbox WS: on' : 'Inbox WS: polling',
          ok: inboxWsConnected,
        },
      ];

      if (API_BASE_GUARD.blocked) {
        next.unshift({ id: 'api', label: 'API: localhost (блок)', ok: false });
      } else if (API_BASE_GUARD.isLocalhost) {
        next.unshift({ id: 'api', label: 'API: localhost', ok: false });
      }

      if (user.role === 'contractor' && h0Probe.failed) {
        next.push({ id: 'h0', label: 'H0: status unknown', ok: false });
      } else if (h0) {
        next.push({
          id: 'h0',
          label: h0.ready_for_investor_demo
            ? `H0: ready ${h0.score}%`
            : `H0: ${h0.blockers?.length || 0} blockers`,
          ok: Boolean(h0.ready_for_investor_demo),
        });
      }

      setChips(next);
    })().catch((error) => reportError('integrationHealth.load', error, { userId: user.id }));
    return () => {
      alive = false;
    };
  }, [user?.id, user?.role, inboxWsConnected]);

  const degraded = useMemo(() => chips.filter((c) => !c.ok), [chips]);

  // Investor UX: не засорять first viewport, если всё live
  if (!chips.length) return null;
  if (!degraded.length && !expanded) return null;

  const summary =
    degraded.length === 0
      ? 'Системы: live'
      : `Системы: ${degraded.length} требуют внимания`;

  return (
    <View style={s.wrap} accessibilityLabel="Статус интеграций">
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        hitSlop={6}
      >
        <Text style={s.summary}>
          {summary}
          {expanded ? ' · свернуть' : ' · подробнее'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={s.chips}>
          {chips.map((c) => (
            <View key={c.id} style={[s.chip, c.ok ? s.ok : s.warn]}>
              <Text style={s.txt}>{c.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 10, gap: 6 },
  summary: {
    fontSize: 12,
    fontWeight: '600',
    color: RenovaTheme.colors.textMuted,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  ok: { backgroundColor: 'rgba(34,140,80,0.12)' },
  warn: { backgroundColor: 'rgba(160,120,40,0.12)' },
  txt: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.textMuted },
});
