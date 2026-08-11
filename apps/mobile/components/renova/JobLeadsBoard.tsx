/** Заявки marketplace — КП → проект (W119 SoT + W130 CTAs + W140 форма) */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, TextInput, StyleSheet } from 'react-native';
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
import type { OsRole } from '@/constants/osSections';
import { reportError } from '@/lib/reportError';

const RENOVATION_LABEL: Record<string, string> = {
  cosmetic: 'Косметический',
  capital: 'Капитальный',
  bathroom: 'Ванная',
  kitchen: 'Кухня',
};

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
  const osRole = (role === 'contractor' ? 'contractor' : 'customer') as OsRole;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // Backend defaults to status=open. Fetch quoted explicitly as well or the lead
      // disappears exactly when the customer needs the «→ Проект» action.
      const [quotedRows, openRows] = await Promise.all([
        api.listJobLeads(userId, 'quoted'),
        api.listJobLeads(userId, 'open'),
      ]);
      setItems([...quotedRows, ...openRows]);
      setLoadedOnce(true);
      setLoadError(false);
    } catch (error) {
      reportError('jobLeads.load', error, { userId });
      // Preserve last confirmed rows. A failed refresh must not become a fake empty board.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

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
    showActionConfirm({
      title: 'Не удалось',
      message: error instanceof Error ? error.message : fallback,
    });
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
            Ответьте КП → заказчик принимает → «→ Проект». Создать объект вручную нельзя.
          </Text>
        </View>
      )}
      <Text style={s.head}>Заявки</Text>
      {loading && !loadedOnce ? <ActivityIndicator color={RenovaTheme.colors.primary} style={s.loader} /> : null}
      {loadError ? (
        <View style={s.loadErrorBox}>
          <Text style={s.err}>
            Не удалось обновить заявки. {loadedOnce ? 'Показаны последние подтверждённые данные.' : 'Пустой список не означает, что заявок нет.'}
          </Text>
          <PrimaryButton title="Повторить загрузку" variant="outline" loading={loading} onPress={() => void load()} />
        </View>
      ) : null}
      {loadedOnce && !loadError && items.length === 0 ? (
        <Text style={s.empty}>Активных заявок пока нет.</Text>
      ) : null}
      {items.map((l) => (
        <View key={l.id} style={s.row}>
          <Text style={s.n}>
            {l.title} · {l.status}
          </Text>
          <Text style={s.sub}>
            {[
              RENOVATION_LABEL[l.renovation_type] || l.renovation_type,
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
          <LeadChat userId={userId} leadId={l.id} />
          {role === 'customer' && l.status === 'open' && (l.quotes?.length ?? 0) > 0 ? (
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
          {role === 'customer' && l.status === 'open' ? (
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
              title="→ Проект"
              variant="outline"
              onPress={() => {
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
          {role === 'contractor' && l.status === 'open' ? (
            <View style={s.qrow}>
              <TextInput
                style={s.inp}
                placeholder="₽"
                keyboardType="numeric"
                value={quote[l.id] || ''}
                onChangeText={(value: string) => setQuote((prev) => ({ ...prev, [l.id]: value }))}
              />
              <PrimaryButton
                title="КП"
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
      ))}
      {role === 'customer' ? (
        <>
          <PrimaryButton
            title="+ Заявка"
            variant="outline"
            disabled={creating}
            onPress={() => setCreateOpen(true)}
          />
          <CreateJobLeadSheet
            visible={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreate={onCreateLead}
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
  q: { fontWeight: '700', color: '#2563eb', marginTop: 4 },
  qrow: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  inp: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, flex: 1 },
});
