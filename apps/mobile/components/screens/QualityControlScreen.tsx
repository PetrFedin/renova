import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { api } from '@/lib/api';
import type { ProjectIssue } from '@/lib/api/types';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { pushOsNav } from '@/lib/pushOsNav';
import { objectTabRoute, tabsRoute, type OsRole } from '@/constants/osSections';
import { alertWarrantyClosed } from '@/lib/warrantyNav';
import { reportError } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import {
  issueActions,
  issueWaitingHint,
  type IssueTransitionAction,
} from '@/lib/domain/issueLifecycle';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';

function mediaUrl(path?: string | null) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${API_BASE}${path}`;
}

function statusLabel(status: string) {
  switch (status) {
    case 'open': return 'Открыто';
    case 'assigned': return 'Назначено';
    case 'in_progress': return 'В работе';
    case 'fixed': return 'Исправлено · ждёт проверки';
    case 'review': return 'Проверка';
    case 'closed': return 'Закрыто';
    case 'rejected': return 'Отклонено';
    default: return status;
  }
}

function severityLabel(severity: string) {
  switch (severity) {
    case 'critical': return 'Критично';
    case 'high': return 'Высокий';
    case 'medium': return 'Средний';
    case 'low': return 'Низкий';
    default: return severity || 'Без оценки';
  }
}

function severityTone(severity: string) {
  if (severity === 'critical' || severity === 'high') return RenovaTheme.colors.dangerText;
  if (severity === 'medium') return RenovaTheme.colors.warningText;
  return RenovaTheme.colors.successText;
}

function dueLabel(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function IssueCard({
  item,
  actions,
  onTransition,
  onWarrantyClose,
  onEscalate,
  mutationKey,
  busy,
  focused,
  waitingHint,
  role,
}: {
  item: ProjectIssue;
  actions: IssueTransitionAction[];
  onTransition: (issue: ProjectIssue, action: IssueTransitionAction) => void;
  onWarrantyClose?: (issue: ProjectIssue) => void;
  onEscalate?: (issue: ProjectIssue) => void;
  mutationKey: string | null;
  busy: boolean;
  focused?: boolean;
  waitingHint?: string | null;
  role: OsRole;
}) {
  const isClosed = item.status === 'closed';
  const tone = severityTone(item.severity);
  const isWarranty = (item.title || '').startsWith('[Гарантия]');
  const dateLabel = dueLabel(item.due_at);

  return (
    <View style={[styles.issueCard, isClosed && styles.closedCard, focused && styles.focusedCard]}>
      <View style={styles.issueHeader}>
        <View style={styles.issueMain}>
          <Text style={styles.issueTitle}>{item.title}</Text>
          <Text style={styles.issueMeta}>
            {statusLabel(item.status)} · {severityLabel(item.severity)}
            {item.floor_plan_id ? ' · на плане' : ''}
            {dateLabel ? ` · до ${dateLabel}` : ''}
          </Text>
        </View>
        <View style={[styles.badge, { borderColor: tone }]}>
          <Text style={[styles.badgeText, { color: tone }]}>{severityLabel(item.severity)}</Text>
        </View>
      </View>

      {item.description ? <Text style={styles.issueText}>{item.description}</Text> : null}
      {mediaUrl(item.photo_url) ? (
        <Image source={{ uri: mediaUrl(item.photo_url)! }} style={styles.issuePhoto} resizeMode="cover" />
      ) : null}

      {waitingHint ? <Text style={styles.waitingHint}>{waitingHint}</Text> : null}

      <View style={styles.issueFooter}>
        {item.stage_id ? (
          <PrimaryButton
            title="Этап"
            variant="outline"
            compact
            disabled={busy}
            onPress={() =>
              pushOsNav(
                { pathname: '/stage/[id]', params: { id: item.stage_id! } },
                '/quality-control',
                role,
              )
            }
          />
        ) : null}
        {item.floor_plan_id ? (
          <PrimaryButton
            title="План"
            variant="outline"
            compact
            disabled={busy}
            onPress={() => pushOsNav(objectTabRoute(role, 'plan', 'floor'), '/quality-control', role)}
          />
        ) : null}

        {actions.map((action) => {
          const key = `${item.id}:${action.target}`;
          return (
            <PrimaryButton
              key={action.target}
              title={action.label}
              variant={action.intent === 'secondary' ? 'outline' : 'primary'}
              compact
              loading={mutationKey === key}
              disabled={busy && mutationKey !== key}
              onPress={() => onTransition(item, action)}
            />
          );
        })}

        {isWarranty && onWarrantyClose ? (
          <PrimaryButton
            title="Закрыть гарантию"
            compact
            loading={mutationKey === `${item.id}:warranty-close`}
            disabled={busy && mutationKey !== `${item.id}:warranty-close`}
            onPress={() => onWarrantyClose(item)}
          />
        ) : null}

        {!isClosed && onEscalate && !(item.title || '').startsWith('[Спор]') ? (
          <PrimaryButton
            title="В спор"
            variant="outline"
            compact
            loading={mutationKey === `${item.id}:escalate`}
            disabled={busy && mutationKey !== `${item.id}:escalate`}
            onPress={() => onEscalate(item)}
          />
        ) : null}
      </View>
    </View>
  );
}

export function QualityControlScreen() {
  const { user, activeProject, readOnly } = useRenova();
  const params = useLocalSearchParams<{ issueId?: string }>();
  const focusIssueId = Array.isArray(params.issueId) ? params.issueId[0] : params.issueId;
  const [items, setItems] = useState<ProjectIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const mutationRef = useRef(false);
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const busy = mutationKey !== null;

  const load = useCallback(async () => {
    if (!user || !activeProject) return;
    try {
      const result = await api.listIssues(user.id, activeProject.id);
      setItems(result);
      setLoadError(false);
    } catch (error) {
      reportError('QualityControl.load', error);
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, activeProject?.id]);

  useProjectDataReload(load);
  useEffect(() => { void load(); }, [load]);

  const openIssues = useMemo(() => {
    const open = items.filter((item) => item.status !== 'closed');
    if (!focusIssueId) return open;
    return [...open].sort((a, b) => Number(b.id === focusIssueId) - Number(a.id === focusIssueId));
  }, [items, focusIssueId]);
  const closedIssues = useMemo(() => items.filter((item) => item.status === 'closed'), [items]);
  const criticalIssues = useMemo(
    () => openIssues.filter((item) => item.severity === 'critical' || item.severity === 'high'),
    [openIssues],
  );
  const waitingVerification = useMemo(
    () => openIssues.filter((item) => item.status === 'fixed' || item.status === 'review').length,
    [openIssues],
  );

  const runMutation = async (
    key: string,
    offlineLabel: string,
    operation: () => Promise<unknown>,
  ): Promise<boolean> => {
    if (!user || !activeProject || mutationRef.current) return false;
    mutationRef.current = true;
    setMutationKey(key);
    try {
      await operation();
      await load();
      await syncProjectSideEffects({ user, project: activeProject });
      return true;
    } catch (error: unknown) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued(offlineLabel);
        return true;
      }
      showActionConfirm({
        title: 'Статус не изменён',
        message: error instanceof Error ? error.message : 'Повторите операцию ещё раз.',
      });
      return false;
    } finally {
      mutationRef.current = false;
      setMutationKey(null);
    }
  };

  const transitionIssue = (issue: ProjectIssue, action: IssueTransitionAction) => {
    if (readOnly || !user || !activeProject || mutationRef.current) return;
    showActionConfirm({
      title: action.confirmTitle,
      message: `«${issue.title}» → ${statusLabel(action.target)}`,
      primaryLabel: action.label,
      onPrimary: () => {
        void runMutation(
          `${issue.id}:${action.target}`,
          'Изменение замечания',
          () => api.transitionIssue(user.id, activeProject.id, issue.id, action.target),
        );
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const closeWarranty = (issue: ProjectIssue) => {
    if (readOnly || role !== 'customer' || !user || !activeProject || mutationRef.current) return;
    showActionConfirm({
      title: 'Закрыть гарантию?',
      message: `«${issue.title}»`,
      primaryLabel: 'Закрыть',
      onPrimary: () => {
        void (async () => {
          const changed = await runMutation(
            `${issue.id}:warranty-close`,
            'Закрытие гарантии',
            () => api.closeWarrantyClaim(user.id, activeProject.id, issue.id),
          );
          if (changed) alertWarrantyClosed('customer');
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const escalateIssue = (issue: ProjectIssue) => {
    if (readOnly || !user || !activeProject || mutationRef.current) return;
    showActionConfirm({
      title: 'Эскалировать в спор?',
      message: `«${issue.title}». Стороны получат уведомление.`,
      primaryLabel: 'В спор',
      onPrimary: () => {
        void runMutation(
          `${issue.id}:escalate`,
          'Эскалация',
          () => api.escalateIssue(user.id, activeProject.id, issue.id),
        );
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  if (!user || !activeProject) {
    return (
      <View style={styles.center}>
        <EmptyActionState
          title="Нет активного проекта"
          hint="Выберите объект на главной, чтобы открыть контроль качества."
          actionLabel="На главную"
          actionVariant="primary"
          onAction={() => pushOsNav(tabsRoute(role, 'index'), undefined, role)}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={RenovaTheme.colors.primaryMuted} />
        <Text style={styles.stateText}>Загружаем замечания...</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <LoadErrorState
          title="Не удалось загрузить замечания"
          hint="Это не пустой список — повторите или напишите в чат."
          onRetry={() => {
            setLoading(true);
            void load();
          }}
          role={role}
          showChatCta
        />
      </View>
    );
  }

  const renderIssue = (item: ProjectIssue) => {
    const isWarranty = (item.title || '').startsWith('[Гарантия]');
    const actions = readOnly ? [] : issueActions(item.status, role, isWarranty);
    return (
      <IssueCard
        key={item.id}
        focused={item.id === focusIssueId}
        item={item}
        actions={actions}
        onTransition={transitionIssue}
        onWarrantyClose={!readOnly && role === 'customer' && isWarranty ? closeWarranty : undefined}
        onEscalate={!readOnly && item.status !== 'closed' ? escalateIssue : undefined}
        mutationKey={mutationKey}
        busy={busy}
        waitingHint={issueWaitingHint(item.status, role, isWarranty)}
        role={role}
      />
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Назад"
          onPress={() => router.back()}
          style={styles.backAction}
        >
          <Text style={styles.back}>‹ Назад</Text>
        </Pressable>
        <Text style={styles.title}>Контроль качества</Text>
        <Text style={styles.subtitle}>Исправление → проверка заказчика → закрытие или доработка.</Text>
        <OfflineSyncStatus compact />
      </View>

      {readOnly ? (
        <View style={styles.noteCard}>
          <Text style={styles.noteText}>Режим просмотра: можно анализировать замечания, но нельзя менять их статус.</Text>
        </View>
      ) : null}

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{openIssues.length}</Text>
          <Text style={styles.summaryLabel}>в работе</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryValue, { color: criticalIssues.length ? RenovaTheme.colors.dangerText : RenovaTheme.colors.successText }]}>
            {criticalIssues.length}
          </Text>
          <Text style={styles.summaryLabel}>критично</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{waitingVerification}</Text>
          <Text style={styles.summaryLabel}>на проверке</Text>
        </View>
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.sectionTitle}>Требуют внимания</Text>
        {openIssues.length
          ? openIssues.map(renderIssue)
          : <Text style={styles.emptyText}>Открытых замечаний нет.</Text>}
      </View>

      {closedIssues.length ? (
        <View style={styles.cardBlock}>
          <Text style={styles.sectionTitle}>Закрытые</Text>
          {closedIssues.slice(0, 5).map(renderIssue)}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: RenovaTheme.spacing.lg, paddingBottom: 32, gap: RenovaTheme.spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, backgroundColor: RenovaTheme.colors.background },
  header: { gap: 4 },
  backAction: { minHeight: RenovaTheme.minTouch, justifyContent: 'center', alignSelf: 'flex-start' },
  back: { ...screenTypography.listLink, marginTop: 0 },
  title: { ...screenTypography.hero },
  subtitle: { ...screenTypography.listMeta, lineHeight: 20 },
  noteCard: { ...listRowStyles.metricCell, alignItems: 'stretch', backgroundColor: RenovaTheme.colors.surfaceMuted, padding: RenovaTheme.spacing.md },
  noteText: { ...screenTypography.empty },
  summaryGrid: { ...listRowStyles.summaryRow },
  summaryCard: { ...listRowStyles.metricCell, gap: 2 },
  summaryValue: { ...screenTypography.metric },
  summaryLabel: { ...screenTypography.metricLabel },
  cardBlock: { gap: RenovaTheme.spacing.sm, marginTop: 4 },
  sectionTitle: { ...screenTypography.section, marginTop: 8, color: RenovaTheme.colors.text },
  issueCard: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
    backgroundColor: 'transparent',
    gap: RenovaTheme.spacing.sm,
  },
  focusedCard: {
    borderColor: RenovaTheme.colors.primary,
    borderWidth: 2,
    backgroundColor: RenovaTheme.colors.infoBg,
    paddingHorizontal: RenovaTheme.spacing.sm,
  },
  closedCard: { opacity: 0.78 },
  issuePhoto: { width: '100%', height: 160, borderRadius: RenovaTheme.radius.md, backgroundColor: RenovaTheme.colors.surfaceMuted },
  issueHeader: { flexDirection: 'row', gap: RenovaTheme.spacing.sm, justifyContent: 'space-between', alignItems: 'flex-start' },
  issueMain: { flex: 1, minWidth: 0 },
  issueTitle: { ...screenTypography.listTitle },
  issueMeta: { ...screenTypography.listMeta },
  issueText: { ...screenTypography.listMeta, lineHeight: 18 },
  waitingHint: { ...screenTypography.empty, color: RenovaTheme.colors.warningText },
  issueFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.sm },
  badge: { borderWidth: 1, borderRadius: RenovaTheme.radius.pill, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: RenovaTheme.colors.surface },
  badgeText: { ...screenTypography.metricLabel },
  emptyText: { ...screenTypography.empty, lineHeight: 18 },
  stateText: { ...screenTypography.empty, textAlign: 'center', lineHeight: 18 },
});
