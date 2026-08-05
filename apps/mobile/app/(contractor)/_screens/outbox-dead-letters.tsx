import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, card } from '@/constants/Theme';
import { api, ApiError } from '@/lib/api';
import type {
  OutboxDeadLetter,
  OutboxDeadLetterHistoryItem,
} from '@/lib/api/admin';
import { useRenova } from '@/lib/context/RenovaContext';
import {
  canClaimDeadLetter,
  canReplayDeadLetter,
  deadLetterClaimLabel,
  deadLetterDispatchLabel,
  deadLetterSafeSummary,
  formatDeadLetterDate,
  type DeadLetterLocalClaim,
} from '@/lib/domain/outboxDeadLetter';
import { reportError } from '@/lib/reportError';
import { useProjectDataReload } from '@/lib/useProjectDataReload';

type ClaimsById = Record<string, DeadLetterLocalClaim>;
type HistoryById = Record<string, OutboxDeadLetterHistoryItem[]>;
type OutboxHealth = {
  poisoned?: number;
  retryable?: number;
  stale_leases?: number;
  oldest_pending_age_seconds?: number | null;
  status?: 'healthy' | 'degraded' | 'critical';
};

function operatorError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Операционный доступ запрещён для этой учётной записи.';
    if (error.status === 404) return 'Событие уже обработано или больше не существует.';
    if (error.code === 'dead_letter_claimed') return 'Событие уже взято другим администратором.';
    if (error.code === 'dead_letter_claim_invalid_or_expired') return 'Захват истёк. Возьмите событие в работу заново.';
    if (error.status === 409) return 'Состояние события изменилось. Обновите список и повторите действие.';
  }
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию.';
}

function shortId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

function claimTone(item: OutboxDeadLetter) {
  if (item.claim_state === 'claimed') return styles.claimWarning;
  if (item.claim_state === 'claimed_self') return styles.claimSuccess;
  if (item.claim_state === 'expired') return styles.claimDanger;
  return styles.claimNeutral;
}

function HistoryRows({ items }: { items: OutboxDeadLetterHistoryItem[] }) {
  if (items.length === 0) {
    return <Text style={styles.muted}>Операторских действий ещё нет.</Text>;
  }
  return (
    <View style={styles.historyList}>
      {items.map((entry, index) => (
        <View key={`${entry.created_at}-${entry.action}-${index}`} style={styles.historyRow}>
          <View style={styles.historyMain}>
            <Text style={styles.historyAction}>{entry.action}</Text>
            <Text style={styles.muted}>{entry.actor_user_id || 'system'}</Text>
          </View>
          <View style={styles.historyMeta}>
            <Text style={entry.status_code < 400 ? styles.historyOk : styles.historyFail}>
              HTTP {entry.status_code}
            </Text>
            <Text style={styles.muted}>{formatDeadLetterDate(entry.created_at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function OutboxDeadLettersScreen() {
  const { user } = useRenova();
  const [items, setItems] = useState<OutboxDeadLetter[]>([]);
  const [total, setTotal] = useState(0);
  const [health, setHealth] = useState<OutboxHealth | null>(null);
  const [claims, setClaims] = useState<ClaimsById>({});
  const [history, setHistory] = useState<HistoryById>({});
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);
  const [confirmReplayId, setConfirmReplayId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (asRefresh = false) => {
    if (!user?.id) return;
    if (asRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [index, releaseHealth] = await Promise.all([
        api.listOutboxDeadLetters(user.id, { limit: 100 }),
        api.getReleaseHealth(user.id),
      ]);
      setItems(index.items);
      setTotal(index.total);
      setHealth(releaseHealth?.integrations?.outbox || null);
      const visibleIds = new Set(index.items.map((item) => item.id));
      setClaims((current) => Object.fromEntries(
        Object.entries(current).filter(([id]) => visibleIds.has(id)),
      ));
      setConfirmReplayId((current) => (current && visibleIds.has(current) ? current : null));
      setOpenHistoryId((current) => (current && visibleIds.has(current) ? current : null));
    } catch (loadError) {
      reportError('app.contractor.outboxDeadLetters.load', loadError);
      setError(operatorError(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);
  useProjectDataReload(load);

  const criticalCount = health?.poisoned ?? total;
  const statusLabel = useMemo(() => {
    if (criticalCount > 0 || health?.status === 'critical') return 'Требуется вмешательство';
    if ((health?.stale_leases ?? 0) > 0 || health?.status === 'degraded') return 'Есть просроченные захваты';
    return 'Очередь здорова';
  }, [criticalCount, health?.stale_leases, health?.status]);

  const claim = useCallback(async (item: OutboxDeadLetter) => {
    if (!user?.id) return;
    setActionId(item.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api.claimOutboxDeadLetter(user.id, item.id);
      setClaims((current) => ({
        ...current,
        [item.id]: { token: result.claim_token, expiresAt: result.claim_expires_at },
      }));
      setNotice(result.replayed ? 'Рабочий захват восстановлен.' : 'Событие закреплено за вами.');
      await load(true);
    } catch (claimError) {
      reportError('app.contractor.outboxDeadLetters.claim', claimError, { outboxId: item.id });
      setError(operatorError(claimError));
      await load(true);
    } finally {
      setActionId(null);
    }
  }, [load, user?.id]);

  const release = useCallback(async (item: OutboxDeadLetter) => {
    if (!user?.id) return;
    const localClaim = claims[item.id];
    if (!localClaim) {
      setError('Локальный токен захвата отсутствует. Возобновите работу с событием.');
      return;
    }
    setActionId(item.id);
    setError(null);
    setNotice(null);
    try {
      await api.releaseOutboxDeadLetter(user.id, item.id, localClaim.token);
      setClaims((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setConfirmReplayId(null);
      setNotice('Событие освобождено для другого администратора.');
      await load(true);
    } catch (releaseError) {
      reportError('app.contractor.outboxDeadLetters.release', releaseError, { outboxId: item.id });
      setError(operatorError(releaseError));
      await load(true);
    } finally {
      setActionId(null);
    }
  }, [claims, load, user?.id]);

  const replay = useCallback(async (item: OutboxDeadLetter) => {
    if (!user?.id) return;
    const localClaim = claims[item.id];
    if (!canReplayDeadLetter(item, localClaim)) {
      setError('Захват недействителен. Возьмите событие в работу заново.');
      return;
    }
    if (confirmReplayId !== item.id) {
      setConfirmReplayId(item.id);
      setNotice('Подтвердите повторную доставку. Операция выполнит выбранное событие немедленно.');
      return;
    }
    setActionId(item.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api.replayOutboxDeadLetter(user.id, item.id, localClaim.token, true);
      setClaims((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setConfirmReplayId(null);
      setNotice(deadLetterDispatchLabel(result.dispatch?.status));
      await load(true);
    } catch (replayError) {
      reportError('app.contractor.outboxDeadLetters.replay', replayError, { outboxId: item.id });
      setError(operatorError(replayError));
      await load(true);
    } finally {
      setActionId(null);
    }
  }, [claims, confirmReplayId, load, user?.id]);

  const toggleHistory = useCallback(async (item: OutboxDeadLetter) => {
    if (!user?.id) return;
    if (openHistoryId === item.id) {
      setOpenHistoryId(null);
      return;
    }
    setOpenHistoryId(item.id);
    if (history[item.id]) return;
    setActionId(item.id);
    try {
      const result = await api.getOutboxDeadLetterHistory(user.id, item.id);
      setHistory((current) => ({ ...current, [item.id]: result.items }));
    } catch (historyError) {
      reportError('app.contractor.outboxDeadLetters.history', historyError, { outboxId: item.id });
      setError(operatorError(historyError));
    } finally {
      setActionId(null);
    }
  }, [history, openHistoryId, user?.id]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <BackHeader title="Проблемные события" />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text style={styles.title}>Очередь восстановления</Text>
            <Text style={styles.subtitle}>
              Только безопасные метаданные. Payload, токены и текст исключений в интерфейс не передаются.
            </Text>
          </View>
          <View style={criticalCount > 0 ? styles.statusCritical : styles.statusHealthy}>
            <Text style={criticalCount > 0 ? styles.statusCriticalText : styles.statusHealthyText}>
              {statusLabel}
            </Text>
          </View>
        </View>

        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{criticalCount}</Text>
            <Text style={styles.metricLabel}>poisoned</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{health?.retryable ?? 0}</Text>
            <Text style={styles.metricLabel}>retryable</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{health?.stale_leases ?? 0}</Text>
            <Text style={styles.metricLabel}>stale leases</Text>
          </View>
        </View>

        <PrimaryButton
          title="Обновить очередь"
          variant="outline"
          onPress={() => load(true)}
          loading={refreshing}
          accessibilityLabel="Обновить очередь проблемных событий"
        />

        {error ? <Text style={styles.errorBanner} accessibilityRole="alert">{error}</Text> : null}
        {notice ? <Text style={styles.noticeBanner}>{notice}</Text> : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={RenovaTheme.colors.primary} />
            <Text style={styles.muted}>Загрузка очереди…</Text>
          </View>
        ) : null}

        {!loading && items.length === 0 ? (
          <View style={styles.empty} testID="dead-letter-empty-state">
            <Text style={styles.emptyTitle}>Проблемных событий нет</Text>
            <Text style={styles.muted}>Все события доставлены или ожидают штатного повторения.</Text>
          </View>
        ) : null}

        {items.map((item) => {
          const localClaim = claims[item.id];
          const replayReady = canReplayDeadLetter(item, localClaim);
          const needsClaimRecovery = item.claim_state === 'claimed_self' && !localClaim;
          const busy = actionId === item.id;
          const confirming = confirmReplayId === item.id;
          const historyOpen = openHistoryId === item.id;
          return (
            <View key={item.id} style={styles.eventCard} testID={`dead-letter-${item.id}`}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderText}>
                  <Text style={styles.eventType}>{item.event_type}</Text>
                  <Text style={styles.eventId}>ID {shortId(item.id)}</Text>
                </View>
                <View style={[styles.claimBadge, claimTone(item)]}>
                  <Text style={styles.claimBadgeText}>{deadLetterClaimLabel(item)}</Text>
                </View>
              </View>

              <Text style={styles.safeSummary}>{deadLetterSafeSummary(item)}</Text>
              <View style={styles.metaGrid}>
                <Text style={styles.meta}>Агрегат: {item.aggregate_type} / {shortId(item.aggregate_id)}</Text>
                <Text style={styles.meta}>Создано: {formatDeadLetterDate(item.created_at)}</Text>
                <Text style={styles.meta}>Payload: {item.payload_size_bytes} байт, содержимое скрыто</Text>
                {item.claim_expires_at ? (
                  <Text style={styles.meta}>Захват до: {formatDeadLetterDate(item.claim_expires_at)}</Text>
                ) : null}
              </View>

              <View style={styles.actions}>
                {canClaimDeadLetter(item) || needsClaimRecovery ? (
                  <PrimaryButton
                    title={needsClaimRecovery ? 'Продолжить работу' : 'Взять в работу'}
                    onPress={() => claim(item)}
                    disabled={busy}
                    loading={busy}
                    size="sm"
                  />
                ) : null}
                {replayReady ? (
                  <PrimaryButton
                    title={confirming ? 'Подтвердить повтор' : 'Повторить доставку'}
                    onPress={() => replay(item)}
                    disabled={busy}
                    loading={busy}
                    variant={confirming ? 'danger' : 'primary'}
                    size="sm"
                  />
                ) : null}
                {item.claim_state === 'claimed_self' && localClaim ? (
                  <PrimaryButton
                    title="Освободить"
                    onPress={() => release(item)}
                    disabled={busy}
                    variant="outline"
                    size="sm"
                  />
                ) : null}
                <PrimaryButton
                  title={historyOpen ? 'Скрыть историю' : 'История'}
                  onPress={() => toggleHistory(item)}
                  disabled={busy}
                  variant="ghost"
                  size="sm"
                />
              </View>

              {confirming ? (
                <Text style={styles.confirmText}>
                  Подтверждение действует только для этого события и текущего захвата.
                </Text>
              ) : null}

              {historyOpen ? (
                <View style={styles.historyBox}>
                  <Text style={styles.historyTitle}>История операторских действий</Text>
                  <HistoryRows items={history[item.id] || []} />
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: RenovaTheme.spacing.lg, gap: RenovaTheme.spacing.md, paddingBottom: 48 },
  hero: { ...card, marginBottom: 0, gap: RenovaTheme.spacing.md },
  heroText: { gap: RenovaTheme.spacing.xs },
  title: { fontSize: RenovaTheme.fontSize.h1, fontWeight: RenovaTheme.fontWeight.extrabold, color: RenovaTheme.colors.text },
  subtitle: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 19 },
  statusCritical: { alignSelf: 'flex-start', backgroundColor: RenovaTheme.colors.dangerBg, borderColor: RenovaTheme.colors.dangerBorder, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RenovaTheme.radius.pill },
  statusHealthy: { alignSelf: 'flex-start', backgroundColor: RenovaTheme.colors.successBg, borderColor: RenovaTheme.colors.successBorder, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RenovaTheme.radius.pill },
  statusCriticalText: { color: RenovaTheme.colors.dangerText, fontWeight: RenovaTheme.fontWeight.bold, fontSize: RenovaTheme.fontSize.caption },
  statusHealthyText: { color: RenovaTheme.colors.successText, fontWeight: RenovaTheme.fontWeight.bold, fontSize: RenovaTheme.fontSize.caption },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.sm },
  metric: { ...card, marginBottom: 0, minWidth: 96, flexGrow: 1 },
  metricValue: { fontSize: RenovaTheme.fontSize.hero, fontWeight: RenovaTheme.fontWeight.extrabold, color: RenovaTheme.colors.text },
  metricLabel: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  errorBanner: { color: RenovaTheme.colors.dangerText, backgroundColor: RenovaTheme.colors.dangerBg, borderColor: RenovaTheme.colors.dangerBorder, borderWidth: 1, borderRadius: RenovaTheme.radius.md, padding: RenovaTheme.spacing.md },
  noticeBanner: { color: RenovaTheme.colors.infoText, backgroundColor: RenovaTheme.colors.infoBg, borderColor: RenovaTheme.colors.infoBorder, borderWidth: 1, borderRadius: RenovaTheme.radius.md, padding: RenovaTheme.spacing.md },
  loading: { alignItems: 'center', gap: RenovaTheme.spacing.sm, padding: RenovaTheme.spacing.xl },
  empty: { ...card, marginBottom: 0, alignItems: 'center', gap: RenovaTheme.spacing.xs, paddingVertical: RenovaTheme.spacing.xxl },
  emptyTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  eventCard: { ...card, marginBottom: 0, gap: RenovaTheme.spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: RenovaTheme.spacing.md },
  cardHeaderText: { flex: 1, gap: RenovaTheme.spacing.xxs },
  eventType: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  eventId: { fontSize: RenovaTheme.fontSize.tiny, color: RenovaTheme.colors.textSubtle },
  claimBadge: { maxWidth: '48%', paddingHorizontal: 8, paddingVertical: 5, borderRadius: RenovaTheme.radius.pill, borderWidth: 1 },
  claimNeutral: { backgroundColor: RenovaTheme.colors.neutralBg, borderColor: RenovaTheme.colors.neutralBorder },
  claimSuccess: { backgroundColor: RenovaTheme.colors.successBg, borderColor: RenovaTheme.colors.successBorder },
  claimWarning: { backgroundColor: RenovaTheme.colors.warningBg, borderColor: RenovaTheme.colors.warningBorder },
  claimDanger: { backgroundColor: RenovaTheme.colors.dangerBg, borderColor: RenovaTheme.colors.dangerBorder },
  claimBadgeText: { fontSize: RenovaTheme.fontSize.tiny, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.text },
  safeSummary: { fontSize: RenovaTheme.fontSize.bodySmall, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.text },
  metaGrid: { gap: RenovaTheme.spacing.xs },
  meta: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.sm },
  confirmText: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.dangerText },
  historyBox: { backgroundColor: RenovaTheme.colors.surfaceMuted, borderRadius: RenovaTheme.radius.md, padding: RenovaTheme.spacing.md, gap: RenovaTheme.spacing.sm },
  historyTitle: { fontSize: RenovaTheme.fontSize.bodySmall, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  historyList: { gap: RenovaTheme.spacing.sm },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: RenovaTheme.spacing.sm, borderTopWidth: 1, borderTopColor: RenovaTheme.colors.border, paddingTop: RenovaTheme.spacing.sm },
  historyMain: { flex: 1 },
  historyMeta: { alignItems: 'flex-end' },
  historyAction: { fontSize: RenovaTheme.fontSize.bodySmall, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.text },
  historyOk: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.successText, fontWeight: RenovaTheme.fontWeight.semibold },
  historyFail: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.dangerText, fontWeight: RenovaTheme.fontWeight.semibold },
  muted: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
});
