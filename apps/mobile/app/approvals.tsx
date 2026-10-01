import { useEffect, useState, useCallback } from 'react';
import { ScrollView, View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api, ApprovalItem } from '@/lib/api';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { RenovaTheme } from '@/constants/Theme';

import { APPROVAL_TYPE_LABEL, approvalSourceLabel, resolveApprovalHref } from '@/lib/approvalLinks';
import { navigateApproval } from '@/lib/navigation';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { objectTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { alertChangeOrderApproved } from '@/lib/procurementNav';
import { alertApprovalApproved, alertApprovalRejected } from '@/lib/fieldCreateNav';
import { reportCatch } from '@/lib/reportError';
import { notifyError } from '@/lib/notify';
import { ApiError } from '@/lib/api/client';

export default function ApprovalsScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user, activeProject, readOnly } = useRenova();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const isCustomer = user?.role === 'customer';
  const role: OsRole = isCustomer ? 'customer' : 'contractor';

  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');

  const load = useCallback(() => {
    if (!user || !activeProject) return;
    setLoadState('loading');
    api.approvalHub(user.id, activeProject.id)
      .then((r) => {
        setItems(r.items);
        setLoadState('loaded');
      })
      .catch((e) => {
        reportCatch('app.approvals.1')(e);
        setLoadState('error');
      });
  }, [user?.id, activeProject?.id]);
  useEffect(() => { load(); }, [load]);
  useProjectDataReload(load);

  const key = (it: ApprovalItem) => `${it.type}-${it.id}`;
  const reason = (it: ApprovalItem) => reasons[key(it)] || '';

  /** INB-05: кто решает — определяет сервер (allowed_actions): заказчик по смете/материалам, исполнитель по заявкам на комнаты */
  const canDecide = (it: ApprovalItem) => !readOnly && Boolean(it.allowed_actions?.includes('approve'));

  /** INB-06: очередь — отдельный диалог; отказ сервера — причина; после 404/409 список перечитывается */
  const handleDecisionError = (e: unknown, queuedLabel: string, title: string) => {
    if (isOfflineQueued(e)) {
      notifyOfflineQueued(queuedLabel, role);
      return;
    }
    reportCatch('app.approvals.decide')(e);
    notifyError(title, e);
    if (e instanceof ApiError && (e.status === 404 || e.status === 409)) load();
  };

  const approve = async (it: ApprovalItem) => {
    if (!user || !activeProject || !canDecide(it)) return;
    const { id: userId } = user;
    const pid = activeProject.id;
    try {
      // W66 #14: единый hub-approve (+ offline queue)
      await api.approveApproval(userId, pid, it.id, it.type);
      await syncProjectSideEffects({ user, project: activeProject });
      load();
      // W133: hub approve → SoT по типу
      if (it.type === 'change_order') {
        alertChangeOrderApproved('customer', it.subtitle?.trim() || 'Доп. работы', undefined);
      } else {
        alertApprovalApproved(role, it.type);
      }
    } catch (e) {
      handleDecisionError(e, 'Согласование', 'Не удалось согласовать');
    }
  };

  return (
    <>
      <BackHeader title="Согласования" returnTo={returnTo} subtitle={readOnly ? 'Только просмотр' : isCustomer ? undefined : 'Заявки заказчика на изменение комнат'} />
      <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 24 }}>
        {loadState === 'loading' && !items.length ? (
          <Text style={s.empty} accessibilityRole="progressbar">Загрузка согласований…</Text>
        ) : null}
        {loadState !== 'error' && items.map(it => (
          <View key={key(it)} style={s.card}>
            <Text style={s.type}>{APPROVAL_TYPE_LABEL[it.type] || it.type}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${it.title}. Открыть источник`}
              onPress={() => navigateApproval(it, role, returnTo)}
            >
            <Text style={s.title}>{it.title}</Text>
            {resolveApprovalHref(it, role) ? (
              <Text style={s.link}>{approvalSourceLabel(it)}</Text>
            ) : null}
          </Pressable>
            {it.subtitle ? <Text style={s.sub}>{it.subtitle}</Text> : null}
            {readOnly ? (
              <Text style={s.wait}>Только просмотр — решения недоступны</Text>
            ) : canDecide(it) ? (
              <>
                <TextInput
                  style={s.inp}
                  placeholder="Комментарий при отклонении"
                  accessibilityLabel="Комментарий при отклонении"
                  value={reason(it)}
                  onChangeText={(v: string) => setReasons(prev => ({ ...prev, [key(it)]: v }))}
                />
                <View style={s.actions}>
                  <PrimaryButton title="Согласовать" variant="accent" onPress={() => {
                    // Clarity S: approve тоже через sheet (симметрия с reject)
                    showActionConfirm({
                      title: 'Согласовать?',
                      message: it.subtitle || it.title || 'Подтвердить решение.',
                      primaryLabel: 'Согласовать',
                      onPrimary: () => { void approve(it); },
                      secondaryLabel: 'Отмена',
                      onSecondary: () => undefined,
                    });
                  }} />
                  <PrimaryButton title="Отклонить" variant="outline" onPress={() => {
                    if (!user || !activeProject || !canDecide(it)) return;
                    // Clarity R: confirm перед отклонением согласования
                    showActionConfirm({
                      title: 'Отклонить согласование?',
                      message: it.subtitle || it.title || 'Решение будет отклонено.',
                      primaryLabel: 'Отклонить',
                      onPrimary: () => {
                        void (async () => {
                          try {
                            await api.rejectApproval(user.id, activeProject.id, it.id, it.type, reason(it));
                            await syncProjectSideEffects({ user, project: activeProject });
                            load();
                            alertApprovalRejected(role, it.type);
                          } catch (e) {
                            handleDecisionError(e, 'Отклонение', 'Не удалось отклонить');
                          }
                        })();
                      },
                      secondaryLabel: 'Отмена',
                      onSecondary: () => undefined,
                    });
                  }} />
                </View>
              </>
            ) : (
              <Text style={s.wait}>Статус: ожидает решения {isCustomer ? 'исполнителя' : 'заказчика'}</Text>
            )}
          </View>
        ))}
        {loadState === 'error' && (
          <LoadErrorState title="Не удалось загрузить согласования" onRetry={load} role={role} />
        )}
        {loadState === 'loaded' && !items.length && (
          <View style={s.emptyBox}>
            <Text style={s.empty}>Нет ожидающих согласований</Text>
            {isCustomer ? (
              <PrimaryButton
                title="Открыть доп. работы в смете"
                variant="outline"
                onPress={() => {
                  const route = objectTabRoute('customer', 'estimate');
                  pushOsNav({ pathname: route.pathname, params: { ...route.params, estimateLayer: 'changes' } }, undefined, 'customer');
                }}
              />
            ) : null}
          </View>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background, padding: 16 },
  card: { backgroundColor: RenovaTheme.colors.surface, padding: 14, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  type: { fontSize: 11, color: RenovaTheme.colors.accent, fontWeight: '700' },
  title: { fontWeight: '700', marginTop: 4 },
  sub: { color: RenovaTheme.colors.textMuted, marginTop: 4, marginBottom: 8 },
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 8, marginBottom: 8, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8 },
  wait: { marginTop: 8, fontSize: 13, color: RenovaTheme.colors.warning, fontWeight: '600' },
  link: { fontSize: 12, color: RenovaTheme.colors.primary, marginTop: 4, fontWeight: '600' },
  emptyBox: { alignItems: 'center', gap: 12, marginTop: 40 },
  empty: { textAlign: 'center', color: RenovaTheme.colors.textMuted },
});
