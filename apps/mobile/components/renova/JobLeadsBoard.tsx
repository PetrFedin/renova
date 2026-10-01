/** Заявки marketplace — КП → проект (W119 SoT + W130 CTAs + W140 форма) */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { api } from '@/lib/api';
import { LeadChat } from '@/components/renova/LeadChat';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { CreateJobLeadSheet } from '@/components/renova/CreateJobLeadSheet';
import type { JobLeadCreateBody } from '@/lib/api/market';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import {
  alertJobLeadAssigned,
  alertJobLeadCreated,
  alertJobLeadQuoted,
} from '@/lib/jobLeadNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { confirmAction, notifyError } from '@/lib/notify';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import {
  LEADS_PAGE_SIZE,
  RENOVATION_TYPE_OPTIONS,
  buildLeadFeedQuery,
  contractorLeadNote,
  hasActiveLeadFilters,
  hasMorePages,
  jobLeadActions,
  jobLeadStatusLabel,
  mergeLeadPages,
  renovationTypeLabel,
  type LeadFeedFilters,
} from '@/lib/domain/jobLeadUi';
import type { OsRole } from '@/constants/osSections';
import { reportError } from '@/lib/reportError';

type L = {
  id: string;
  title: string;
  address?: string;
  location_public?: string;
  address_precision?: 'full' | 'public';
  area_sqm?: number;
  renovation_type: string;
  budget_hint?: number;
  pre_estimate?: number;
  description?: string | null;
  status: string;
  assigned_contractor_id?: string | null;
  quotes?: { id: string; contractor_id: string; pre_estimate: number }[];
};

function parseQuoteAmount(raw: string | undefined): number | null {
  const value = Number(String(raw ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function JobLeadsBoard({ userId, role }: { userId: string; role: string }) {
  const { user, activeProject, loadProject, refreshProjects } = useRenova();
  const [items, setItems] = useState<L[]>([]);
  const [quote, setQuote] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const itemsRef = useRef<L[]>([]);
  const [openOffset, setOpenOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draftFilters, setDraftFilters] = useState<LeadFeedFilters>({ city: '', renovationType: null });
  const [filters, setFilters] = useState<LeadFeedFilters>({ city: '', renovationType: null });
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [editing, setEditing] = useState<L | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  itemsRef.current = items;
  const osRole = (role === 'contractor' ? 'contractor' : 'customer') as OsRole;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // Backend defaults to status=open. Fetch quoted explicitly as well or the lead
      // disappears exactly when the customer needs the «→ Проект» action.
      // Фильтры/страницы — только для ленты открытых; без новых опросов.
      const [quotedRows, openRows] = await Promise.all([
        api.listJobLeads(userId, 'quoted'),
        api.listJobLeads(userId, 'open', buildLeadFeedQuery(filters, 0)),
      ]);
      setItems([...quotedRows, ...openRows]);
      setOpenOffset(openRows.length);
      setHasMore(hasMorePages(openRows.length, openRows.length));
      setLoadedOnce(true);
      setLoadError(false);
    } catch (error) {
      reportError('jobLeads.load', error, { userId });
      // Preserve last confirmed rows. A failed refresh must not become a fake empty board.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [userId, filters]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.listJobLeads(userId, 'open', buildLeadFeedQuery(filters, openOffset));
      const merged = mergeLeadPages(itemsRef.current, page);
      setItems(merged.items);
      setOpenOffset((o) => o + page.length);
      setHasMore(hasMorePages(page.length, merged.added));
    } catch (error) {
      notifyError('Не удалось загрузить ещё', error);
    } finally {
      setLoadingMore(false);
    }
  }, [userId, filters, openOffset, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);
  useProjectDataReload(load);

  const reconcileAfterCommit = useCallback(
    async (operation: string): Promise<void> => {
      try {
        await syncProjectSideEffects({ user, project: activeProject });
      } catch (error) {
        reportError('jobLeads.postCommit.sync', error, {
          operation,
          userId,
          projectId: activeProject?.id ?? null,
        });
      }
      await load();
    },
    [user, activeProject, userId, load],
  );

  const showMutationFailure = (scope: string, error: unknown, fallback: string) => {
    reportError(scope, error, { userId });
    notifyError('Не удалось', error, fallback);
  };

  const runLeadAction = async (
    leadId: string,
    scope: string,
    failTitle: string,
    op: () => Promise<unknown>,
    done: string,
  ): Promise<void> => {
    setBusyId(leadId);
    try {
      await op();
    } catch (error) {
      reportError(scope, error, { userId, leadId });
      notifyError(failTitle, error);
      setBusyId(null);
      return;
    }
    setBusyId(null);
    showActionConfirm({ title: done, message: 'Список заявок обновлён.' });
    await reconcileAfterCommit(scope);
  };

  const onWithdrawQuote = async (l: L) => {
    const ok = await confirmAction({
      title: 'Отозвать отклик?',
      message: 'Заказчик больше не увидит ваше КП по этой заявке. Позже можно отправить новое.',
      confirmLabel: 'Отозвать',
      destructive: true,
    });
    if (!ok) return;
    await runLeadAction(l.id, 'jobLeads.withdrawQuote', 'Не удалось отозвать отклик', () => api.withdrawJobLeadQuote(userId, l.id), 'Отклик отозван');
  };

  const onDeclineAssignment = async (l: L) => {
    const ok = await confirmAction({
      title: 'Отказаться от заявки?',
      message: 'Заявка вернётся заказчику, он сможет выбрать другого исполнителя.',
      confirmLabel: 'Отказаться',
      destructive: true,
    });
    if (!ok) return;
    await runLeadAction(l.id, 'jobLeads.declineAssignment', 'Не удалось отказаться от заявки', () => api.declineJobLeadAssignment(userId, l.id), 'Вы отказались от заявки');
  };

  const onCloseLead = async (l: L) => {
    const ok = await confirmAction({
      title: 'Закрыть заявку?',
      message: 'Исполнители перестанут её видеть и присылать КП.',
      confirmLabel: 'Закрыть заявку',
      destructive: true,
    });
    if (!ok) return;
    const reason = closeReason;
    await runLeadAction(l.id, 'jobLeads.close', 'Не удалось закрыть заявку', () => api.closeJobLead(userId, l.id, reason), 'Заявка закрыта');
    setClosingId(null);
    setCloseReason('');
  };

  const onEditLead = async (leadId: string, body: JobLeadCreateBody) => {
    try {
      await api.updateJobLead(userId, leadId, body);
    } catch (error) {
      reportError('jobLeads.update.mutation', error, { userId, leadId });
      throw error;
    }
    void reconcileAfterCommit('update');
  };

  const onCreateLead = async (body: JobLeadCreateBody) => {
    setCreating(true);
    try {
      try {
        await api.createJobLead(userId, body);
      } catch (error) {
        reportError('jobLeads.create.mutation', error, { userId });
        throw error;
      }

      // Mutation truth first: the sheet may close even if non-authoritative refresh later fails.
      alertJobLeadCreated(osRole);
      void reconcileAfterCommit('create');
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={s.box}>
      {role === 'contractor' && (
        <View style={s.info}>
          <Text style={s.infoT}>Новые объекты — через заявки</Text>
          <Text style={s.infoSub}>
            Ответьте КП → заказчик принимает и создаёт объект. Создать объект вручную нельзя.
          </Text>
        </View>
      )}
      <Text style={s.head}>Заявки</Text>
      {loading && !loadedOnce ? <ActivityIndicator color={RenovaTheme.colors.primary} style={s.loader} /> : null}
      {role === 'contractor' ? (
        <View style={s.filters}>
          <TextInput
            style={s.inp}
            placeholder="Город"
            value={draftFilters.city}
            onChangeText={(v: string) => setDraftFilters((f) => ({ ...f, city: v }))}
            onSubmitEditing={() => setFilters(draftFilters)}
            returnKeyType="search"
          />
          <View style={s.chips}>
            {[{ id: null as string | null, label: 'Любой тип' }, ...RENOVATION_TYPE_OPTIONS].map((o) => {
              const on = draftFilters.renovationType === o.id;
              return (
                <Pressable
                  key={o.id ?? 'any'}
                  style={[s.chip, on && s.chipOn]}
                  onPress={() => setDraftFilters((f) => ({ ...f, renovationType: o.id }))}
                  accessibilityRole="button"
                >
                  <Text style={[s.chipT, on && s.chipTOn]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={s.qrow}>
            <PrimaryButton title="Применить" variant="outline" onPress={() => setFilters(draftFilters)} />
            {hasActiveLeadFilters(filters) || hasActiveLeadFilters(draftFilters) ? (
              <PrimaryButton
                title="Сбросить"
                variant="ghost"
                onPress={() => {
                  const empty = { city: '', renovationType: null };
                  setDraftFilters(empty);
                  setFilters(empty);
                }}
              />
            ) : null}
          </View>
        </View>
      ) : null}
      {loadError && !loadedOnce ? (
        <LoadErrorState
          title="Не удалось загрузить заявки"
          hint="Пустой список не означает, что заявок нет. Повторите."
          onRetry={() => void load()}
        />
      ) : null}
      {loadError && loadedOnce ? (
        <View style={s.loadErrorBox}>
          <Text style={s.err}>Не удалось обновить заявки. Показаны последние подтверждённые данные.</Text>
          <PrimaryButton title="Повторить загрузку" variant="outline" loading={loading} onPress={() => void load()} />
        </View>
      ) : null}
      {loadedOnce && !loadError && items.length === 0 ? (
        <EmptyActionState
          title={hasActiveLeadFilters(filters) ? 'По фильтру заявок нет' : 'Активных заявок пока нет'}
          hint={
            role === 'customer'
              ? 'Создайте заявку — исполнители пришлют КП.'
              : hasActiveLeadFilters(filters)
                ? 'Сбросьте город или тип ремонта.'
                : 'Новые заявки появятся здесь.'
          }
          actionLabel={role === 'customer' ? 'Создать заявку' : undefined}
          onAction={role === 'customer' ? () => setCreateOpen(true) : undefined}
          actionVariant="accent"
        />
      ) : null}
      {items.map((l) => {
        const act = jobLeadActions(role, userId, l);
        const note = role === 'contractor' ? contractorLeadNote(l, userId) : null;
        const busy = busyId === l.id;
        return (
        <View key={l.id} style={s.row}>
          <Text style={s.n}>
            {l.title} · {jobLeadStatusLabel(l.status)}
          </Text>
          <Text style={s.sub}>
            {[
              renovationTypeLabel(l.renovation_type),
              l.address || l.location_public,
              l.area_sqm != null ? `${l.area_sqm} м²` : null,
              l.budget_hint != null ? formatRub(l.budget_hint) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {l.description ? (
            <Text style={s.desc} numberOfLines={2}>
              {l.description}
            </Text>
          ) : null}
          {l.pre_estimate ? <Text style={s.q}>Оценка: {formatRub(l.pre_estimate)}</Text> : null}
          {note ? <Text style={s.note}>{note}</Text> : null}
          <LeadChat userId={userId} leadId={l.id} available={l.status !== 'open'} />
          {act.canPickQuote && (l.quotes?.length ?? 0) > 0 ? (
            <View style={{ gap: 6, marginTop: 6 }}>
              <Text style={s.sub}>Выберите КП:</Text>
              {l.quotes!.map((q) => (
                <PrimaryButton
                  key={q.id}
                  title={`Принять · ${formatRub(q.pre_estimate)}`}
                  onPress={() => {
                    showActionConfirm({
                      title: 'Принять КП?',
                      message: `${formatRub(q.pre_estimate)} — исполнитель будет закреплён за заявкой.`,
                      primaryLabel: 'Принять',
                      onPrimary: () => {
                        void (async () => {
                          try {
                            await api.acceptJobLeadQuote(userId, l.id, q.id);
                          } catch (error) {
                            showMutationFailure('jobLeads.acceptQuote.mutation', error, 'Ошибка принятия КП');
                            return;
                          }
                          alertJobLeadAssigned(osRole);
                          void reconcileAfterCommit('accept_quote');
                        })();
                      },
                      secondaryLabel: 'Отмена',
                      onSecondary: () => undefined,
                    });
                  }}
                />
              ))}
            </View>
          ) : null}
          {act.canPickQuote ? (
            <PrimaryButton
              title="Авто-исполнитель"
              variant="outline"
              onPress={() => {
                showActionConfirm({
                  title: 'Авто-назначить?',
                  message: 'Система выберет исполнителя по правилам площадки.',
                  primaryLabel: 'Назначить',
                  onPrimary: () => {
                    void (async () => {
                      try {
                        await api.autoAssignLead(userId, l.id);
                      } catch (error) {
                        showMutationFailure('jobLeads.autoAssign.mutation', error, 'Ошибка назначения');
                        return;
                      }
                      alertJobLeadAssigned(osRole);
                      void reconcileAfterCommit('auto_assign');
                    })();
                  },
                  secondaryLabel: 'Отмена',
                  onSecondary: () => undefined,
                });
              }}
            />
          ) : null}
          {l.status === 'quoted' ? (
            <PrimaryButton
              title={role === 'contractor' ? 'Условия заявки и цена КП' : '→ Проект'}
              variant="outline"
              onPress={() => {
                // MKT-028: объект из заявки создаёт заказчик; исполнителю — сводка условий.
                if (role === 'contractor') {
                  pushOsNav({ pathname: `/contractor-wizard/${l.id}` }, '/job-leads', osRole);
                  return;
                }
                void (async () => {
                  let converted: { project_id: string; name: string };
                  try {
                    converted = await api.convertJobLead(userId, l.id);
                  } catch (error) {
                    showMutationFailure('jobLeads.convert.mutation', error, 'Не удалось создать проект из заявки');
                    return;
                  }

                  // The lead is already converted on the server. Refresh failures below
                  // must never encourage the customer to repeat the conversion mutation.
                  void load();
                  try {
                    await refreshProjects();
                  } catch (error) {
                    reportError('jobLeads.convert.refreshProjects', error, { userId, projectId: converted.project_id });
                  }

                  try {
                    await loadProject(converted.project_id);
                  } catch (error) {
                    reportError('jobLeads.convert.loadProject', error, { userId, projectId: converted.project_id });
                    showActionConfirm({
                      title: 'Проект создан',
                      message: 'Заявка преобразована в проект, но открыть его автоматически не удалось. Обновите проекты и выберите объект.',
                      primaryLabel: 'Обновить проекты',
                      onPrimary: () => {
                        void refreshProjects().catch((refreshError: unknown) => {
                          reportError('jobLeads.convert.retryRefreshProjects', refreshError, {
                            userId,
                            projectId: converted.project_id,
                          });
                        });
                      },
                      secondaryLabel: 'На главную',
                      onSecondary: () => replaceOsNav('/(customer)/(tabs)/', undefined, 'customer'),
                    });
                    return;
                  }

                  // loadProject already switches active project, emits project-data change
                  // and refreshes inbox for the newly loaded object. Do not sync stale activeProject here.
                  replaceOsNav('/(customer)/(tabs)/', undefined, 'customer');
                })();
              }}
            />
          ) : null}
          {act.canWithdrawQuote ? (
            <PrimaryButton title="Отозвать отклик" variant="dangerOutline" disabled={busy} onPress={() => void onWithdrawQuote(l)} />
          ) : null}
          {act.canDecline ? (
            <PrimaryButton title="Отказаться от заявки" variant="dangerOutline" disabled={busy} onPress={() => void onDeclineAssignment(l)} />
          ) : null}
          {act.canEdit ? (
            <PrimaryButton title="Редактировать" variant="outline" disabled={busy} onPress={() => setEditing(l)} />
          ) : null}
          {act.canClose ? (
            closingId === l.id ? (
              <View style={{ gap: 6, marginTop: 6 }}>
                <TextInput
                  style={s.inp}
                  placeholder="Причина (необязательно)"
                  value={closeReason}
                  onChangeText={setCloseReason}
                  maxLength={500}
                />
                <PrimaryButton title="Закрыть заявку" variant="danger" disabled={busy} onPress={() => void onCloseLead(l)} />
                <PrimaryButton title="Не закрывать" variant="ghost" onPress={() => { setClosingId(null); setCloseReason(''); }} />
              </View>
            ) : (
              <PrimaryButton title="Закрыть заявку" variant="dangerOutline" disabled={busy} onPress={() => { setClosingId(l.id); setCloseReason(''); }} />
            )
          ) : null}
          {act.canQuote ? (
            <View style={s.qrow}>
              <TextInput
                style={s.inp}
                placeholder="₽"
                keyboardType="numeric"
                value={quote[l.id] || ''}
                onChangeText={(value: string) => setQuote((prev) => ({ ...prev, [l.id]: value }))}
              />
              <PrimaryButton
                title={act.awaitingPick ? 'Обновить КП' : 'КП'}
                variant="accent"
                disabled={!quote[l.id]?.trim()}
                onPress={() => {
                  const amount = parseQuoteAmount(quote[l.id]);
                  if (amount == null) {
                    showActionConfirm({
                      title: 'Сумма КП',
                      message: 'Укажите сумму больше нуля.',
                    });
                    return;
                  }
                  void (async () => {
                    try {
                      await api.quoteJobLead(userId, l.id, amount);
                    } catch (error) {
                      showMutationFailure('jobLeads.quote.mutation', error, 'Не удалось отправить КП');
                      return;
                    }
                    setQuote((prev) => ({ ...prev, [l.id]: '' }));
                    alertJobLeadQuoted(osRole);
                    void reconcileAfterCommit('quote');
                  })();
                }}
              />
            </View>
          ) : null}
        </View>
        );
      })}
      {hasMore ? (
        <PrimaryButton title="Показать ещё" variant="outline" loading={loadingMore} onPress={() => void loadMore()} />
      ) : null}
      {role === 'customer' ? (
        <>
          <PrimaryButton
            title="+ Заявка"
            variant="accent"
            disabled={creating}
            onPress={() => setCreateOpen(true)}
          />
          <CreateJobLeadSheet
            visible={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreate={onCreateLead}
          />
          <CreateJobLeadSheet
            mode="edit"
            visible={editing != null}
            initial={
              editing
                ? {
                    title: editing.title,
                    address: editing.address,
                    area_sqm: editing.area_sqm ?? 0,
                    renovation_type: editing.renovation_type,
                    budget_hint: editing.budget_hint ?? 0,
                    description: editing.description ?? undefined,
                  }
                : undefined
            }
            onClose={() => setEditing(null)}
            onCreate={(body) => onEditLead(editing!.id, body)}
          />
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  info: {
    backgroundColor: RenovaTheme.colors.infoBg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  infoT: { fontWeight: '700', marginBottom: 4 },
  infoSub: { fontSize: 12, color: '#475569', lineHeight: 17 },
  box: { marginVertical: 10 },
  head: { fontWeight: '800', marginBottom: 8 },
  loader: { marginVertical: 10 },
  loadErrorBox: { gap: 8, marginBottom: 8 },
  err: { fontSize: 12, color: RenovaTheme.colors.danger },
  empty: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  row: { backgroundColor: RenovaTheme.colors.surface, padding: 10, borderRadius: 8, marginBottom: 6 },
  n: { fontWeight: '600' },
  sub: { fontSize: 11, color: '#666', marginTop: 2 },
  desc: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 16 },
  note: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  filters: { gap: 8, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: RenovaTheme.colors.border, backgroundColor: RenovaTheme.colors.surfaceMuted },
  chipOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: RenovaTheme.colors.accentMuted },
  chipT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.text },
  chipTOn: { color: RenovaTheme.colors.accent },
  q: { fontWeight: '700', color: '#2563eb', marginTop: 4 },
  qrow: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  inp: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, flex: 1 },
});
