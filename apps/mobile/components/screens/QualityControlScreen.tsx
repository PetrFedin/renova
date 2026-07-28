import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { alertWarrantyClosed, alertWarrantyCreated } from '@/lib/warrantyNav';
import { reportError } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';

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
    case 'fixed': return 'Исправлено';
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
  onClose,
  acting,
  focused,
  canClose,
  closeHint,
  closeLabel = 'Закрыть',
  onEscalate,
  role = 'customer',
}: {
  item: ProjectIssue;
  onClose: (issue: ProjectIssue) => void;
  onEscalate?: (issue: ProjectIssue) => void;
  acting: boolean;
  focused?: boolean;
  canClose: boolean;
  closeHint?: string;
  closeLabel?: string;
  role?: OsRole;
}) {
  const isClosed = item.status === 'closed';
  const tone = severityTone(item.severity);
  return (
    <View style={[styles.issueCard, isClosed && styles.closedCard, focused && styles.focusedCard]}>
      <View style={styles.issueHeader}>
        <View style={styles.issueMain}>
          <Text style={styles.issueTitle}>{item.title}</Text>
          <Text style={styles.issueMeta}>{statusLabel(item.status)} · {severityLabel(item.severity)}{item.floor_plan_id ? ' · на плане' : ''}{dueLabel(item.due_at) ? ` · до ${dueLabel(item.due_at)}` : ''}</Text>
        </View>
        <View style={[styles.badge, { borderColor: tone }]}> 
          <Text style={[styles.badgeText, { color: tone }]}>{severityLabel(item.severity)}</Text>
        </View>
      </View>
      {item.description ? <Text style={styles.issueText}>{item.description}</Text> : null}
      {mediaUrl(item.photo_url) ? (
        <Image source={{ uri: mediaUrl(item.photo_url)! }} style={styles.issuePhoto} resizeMode="cover" />
      ) : null}
      <View style={styles.issueFooter}>
        {item.stage_id ? (
          <PrimaryButton
            title="Этап"
            variant="outline"
            compact
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
            onPress={() =>
              // W121 + Investor P2: слой «Планировка» (пины punch видны)
              pushOsNav(objectTabRoute(role, 'plan', 'floor'), '/quality-control', role)
            }
          />
        ) : null}
        {!isClosed && canClose ? (
          <PrimaryButton title={closeLabel} compact onPress={() => onClose(item)} loading={acting} disabled={acting} />
        ) : null}
        {!isClosed && onEscalate && !(item.title || '').startsWith('[Спор]') ? (
          <PrimaryButton title="Спор" variant="outline" compact onPress={() => onEscalate(item)} disabled={acting} />
        ) : null}
        {!isClosed && !canClose && closeHint ? <Text style={styles.issueMeta}>{closeHint}</Text> : null}
      </View>
    </View>
  );
}

export function QualityControlScreen() {
  const { user, activeProject, readOnly } = useRenova();
  const isCustomer = user?.role === 'customer';
  const params = useLocalSearchParams<{ issueId?: string }>();
  const focusIssueId = Array.isArray(params.issueId) ? params.issueId[0] : params.issueId;
  const [items, setItems] = useState<ProjectIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !activeProject) return;
    try {
      const result = await api.listIssues(user.id, activeProject.id);
      setItems(result);
      setLoadError(false);
    } catch (e) {
      reportError('QualityControl.load', e);
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, activeProject]);
  useProjectDataReload(load);

  useEffect(() => { load(); }, [load]);

  const openIssues = useMemo(() => {
    const open = items.filter((item) => item.status !== 'closed');
    if (!focusIssueId) return open;
    return [...open].sort((a, b) => Number(b.id === focusIssueId) - Number(a.id === focusIssueId));
  }, [items, focusIssueId]);
  const closedIssues = useMemo(() => items.filter((item) => item.status === 'closed'), [items]);
  const criticalIssues = useMemo(() => openIssues.filter((item) => item.severity === 'critical' || item.severity === 'high'), [openIssues]);

  const createWarranty = async () => {
    if (!user || !activeProject || readOnly || !isCustomer) return;
    setActingId('warranty-new');
    try {
      const wRes = await api.createWarrantyClaim(user.id, activeProject.id, {
        title: 'Гарантийное обращение',
        description: 'Создано из Контроля качества',
      });
      await load();
      await syncProjectSideEffects({ user, project: activeProject });
      alertWarrantyCreated(isCustomer ? 'customer' : 'contractor', wRes);
    } catch (e) {
      if (isOfflineQueued(e)) notifyOfflineQueued('Гарантийный тикет');
      else Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось создать');
    } finally {
      setActingId(null);
    }
  };

  const escalateIssue = (issue: ProjectIssue) => {
    if (!user || !activeProject || readOnly) return;
    // Clarity W: pre-confirm (раньше sheet был только post-success)
    showActionConfirm({
      title: 'Эскалировать в спор?',
      message: `«${issue.title}». Стороны получат уведомление.`,
      primaryLabel: 'В спор',
      onPrimary: () => {
        void (async () => {
          try {
            await api.escalateIssue(user.id, activeProject.id, issue.id);
            await load();
            await syncProjectSideEffects({ user, project: activeProject });
            showActionConfirm({
              title: 'Спор',
              message: 'Замечание эскалировано — стороны уведомлены',
            });
          } catch (e) {
            if (isOfflineQueued(e)) notifyOfflineQueued('Эскалация');
            else {
              showActionConfirm({
                title: 'Ошибка',
                message: e instanceof Error ? e.message : 'Не удалось эскалировать',
              });
            }
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const closeIssue = (issue: ProjectIssue) => {
    // W46/W62: гарантию закрывает только заказчик
    if (!user || !activeProject || readOnly) return;
    if ((issue.title || '').startsWith('[Гарантия]') && user.role !== 'customer') return;
    const isWarranty = (issue.title || '').startsWith('[Гарантия]');
    const isContractorFix = !isCustomer && !isWarranty && !(issue.title || '').startsWith('[Спор]');
    showActionConfirm({
      title: isWarranty ? 'Закрыть гарантию?' : isContractorFix ? 'Отметить исправленным?' : 'Закрыть замечание?',
      message: `«${issue.title}»`,
      primaryLabel: isContractorFix ? 'Исправлено' : 'Закрыть',
      onPrimary: () => {
        void (async () => {
          setActingId(issue.id);
          try {
            if (isWarranty) {
              await api.closeWarrantyClaim(user.id, activeProject.id, issue.id);
              await load();
              await syncProjectSideEffects({ user, project: activeProject });
              alertWarrantyClosed(user.role === 'contractor' ? 'contractor' : 'customer');
            } else {
              await api.closeIssue(user.id, activeProject.id, issue.id);
              await load();
              await syncProjectSideEffects({ user, project: activeProject });
            }
          } catch (e) {
            if (isOfflineQueued(e)) notifyOfflineQueued('Закрытие замечания');
          } finally {
            setActingId(null);
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  if (!user || !activeProject) {
    const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
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
    const role: OsRole = user.role === 'contractor' ? 'contractor' : 'customer';
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

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹ Назад</Text></Pressable>
        <Text style={styles.title}>Контроль качества</Text>
        <Text style={styles.subtitle}>Замечания, дефекты и контроль устранения по проекту.</Text>
        <OfflineSyncStatus compact />
      </View>

      {readOnly ? (
        <View style={styles.noteCard}>
          <Text style={styles.noteText}>Режим просмотра: можно анализировать замечания, но нельзя закрывать их.</Text>
        </View>
      ) : null}

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{openIssues.length}</Text>
          <Text style={styles.summaryLabel}>открыто</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryValue, { color: criticalIssues.length ? RenovaTheme.colors.dangerText : RenovaTheme.colors.successText }]}>{criticalIssues.length}</Text>
          <Text style={styles.summaryLabel}>критично</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{closedIssues.length}</Text>
          <Text style={styles.summaryLabel}>закрыто</Text>
        </View>
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.sectionTitle}>Требуют внимания</Text>
        {openIssues.length ? openIssues.map((item) => (
          <IssueCard
            key={item.id}
            focused={item.id === focusIssueId}
            item={item}
            onClose={closeIssue} onEscalate={escalateIssue}
            acting={actingId === item.id}
            canClose={
              !readOnly
              && item.status !== 'fixed'
              && (!(item.title || '').startsWith('[Гарантия]') || Boolean(isCustomer))
            }
            closeHint={
              (item.title || '').startsWith('[Гарантия]') && !isCustomer
                ? 'Гарантию закрывает заказчик'
                : item.status === 'fixed' && !isCustomer
                  ? 'Ждёт подтверждения заказчика'
                  : undefined
            }
            closeLabel={!isCustomer && !(item.title || '').startsWith('[Гарантия]') ? 'Исправлено' : 'Закрыть'}
            role={isCustomer ? 'customer' : 'contractor'}
          />
        )) : <Text style={styles.emptyText}>Открытых замечаний нет. Редкий случай, когда тишина — хороший KPI.</Text>}
      </View>

      {closedIssues.length ? (
        <View style={styles.cardBlock}>
          <Text style={styles.sectionTitle}>Закрытые</Text>
          {closedIssues.slice(0, 5).map((item) => (
            <IssueCard
              key={item.id}
              focused={item.id === focusIssueId}
              item={item}
              onClose={closeIssue} onEscalate={escalateIssue}
              acting={false}
              canClose={false}
              role={isCustomer ? 'customer' : 'contractor'}
            />
          ))}
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
  back: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.primaryMuted, fontWeight: RenovaTheme.fontWeight.semibold },
  title: { fontSize: RenovaTheme.fontSize.h1, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  subtitle: { fontSize: RenovaTheme.fontSize.body, lineHeight: 20, color: RenovaTheme.colors.textMuted },
  /** Clarity K: спокойные контейнеры вместо card-стека */
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
    backgroundColor: '#EFF6FF',
  },
  closedCard: { opacity: 0.7 },
  issuePhoto: { width: '100%', height: 160, borderRadius: RenovaTheme.radius.md, backgroundColor: RenovaTheme.colors.surfaceMuted },
  issueHeader: { flexDirection: 'row', gap: RenovaTheme.spacing.sm, justifyContent: 'space-between', alignItems: 'flex-start' },
  issueMain: { flex: 1, minWidth: 0 },
  issueTitle: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.extrabold },
  issueMeta: { marginTop: 3, fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  issueText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  issueFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.sm },
  badge: { borderWidth: 1, borderRadius: RenovaTheme.radius.pill, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: RenovaTheme.colors.surface },
  badgeText: { fontSize: RenovaTheme.fontSize.tiny, fontWeight: RenovaTheme.fontWeight.extrabold },
  emptyText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  stateTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text, textAlign: 'center' },
  stateText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
