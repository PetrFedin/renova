/** P2.2: Подбор чистовых материалов — room × category × approve */
import { useCallback, useMemo, useState } from 'react';
import { notifyError } from '@/lib/notify';
import { ScrollView, View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { useFocusEffect, usePathname } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { useRenova } from '@/lib/context/RenovaContext';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api, type SelectionItem } from '@/lib/api';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ReasonSheet } from '@/components/renova/ReasonSheet';
import { canProposeSelection, selectionApproveMessage } from '@/lib/domain/selectionPolicy';
import { writeResultMessage } from '@/lib/offlineResultMessage';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { screenLayout } from '@/constants/screenLayout';
import { repairTabRoute, tabsRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { alertSelectionApproved, alertSelectionProposed } from '@/lib/procurementNav';
import { reportError } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { parseNonNegativeNumber } from '@/lib/parseLocaleNumber';

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'tile', label: 'Плитка' },
  { key: 'plumbing', label: 'Сантехника' },
  { key: 'lighting', label: 'Свет' },
  { key: 'doors', label: 'Двери' },
  { key: 'kitchen', label: 'Кухня' },
  { key: 'paint', label: 'Краска' },
  { key: 'other', label: 'Другое' },
];

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  proposed: 'На согласовании',
  approved: 'Согласовано',
  rejected: 'Отклонено',
};

export function OsSelectionsScreen({ role }: { role: OsRole }) {
  const pathname = usePathname();
  const { user, activeProject, readOnly } = useRenova();
  const [items, setItems] = useState<SelectionItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [allowance, setAllowance] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');

  const isCustomer = role === 'customer';
  const selfManaged = !activeProject?.contractor_id;
  const canWrite = canProposeSelection({ role, readOnly: !!readOnly, selfManaged });
  const [rejectTarget, setRejectTarget] = useState<SelectionItem | null>(null);

  const reload = useCallback(() => {
    if (!user || !activeProject) return;
    setLoadState('loading');
    api
      .listSelections(user.id, activeProject.id)
      .then((list) => {
        setItems(list);
        setLoadState('loaded');
      })
      .catch((e) => {
        reportError('components.screens.OsSelectionsScreen.Items', e);
        setLoadState('error');
      });
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useProjectDataReload(reload);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => i.category === filter);
  }, [items, filter]);

  const pending = items.filter((i) => i.status === 'proposed').length;

  if (!activeProject || !user) return <ProjectEmptyState role={role} />;

  if (loadState === 'error') {
    return (
      <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <LoadErrorState title="Не удалось загрузить подбор" onRetry={reload} role={role} showChatCta={role === 'customer'} />
      </ScrollView>
    );
  }

  if (loadState === 'loading' && !items.length) {
    return (
      <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <LoadingState title="Загружаем подбор…" />
      </ScrollView>
    );
  }

  /** Единая обработка сбоя записи: офлайн-очередь или причина от сервера (REP-27). */
  const failWrite = (e: unknown, offlineLabel: string, title: string, key: string) => {
    if (isOfflineQueued(e)) {
      notifyOfflineQueued(offlineLabel, role);
      return;
    }
    reportError(key, e);
    showActionConfirm({
      title,
      message: writeResultMessage(e, 'Повторите попытку.'),
      primaryLabel: 'Понятно',
      onPrimary: () => undefined,
    });
  };

  const roomName = (roomId: string | null) =>
    activeProject.rooms?.find((r) => r.id === roomId)?.name || 'Общее';

  const createItem = async () => {
    if (!title.trim()) {
      showActionConfirm({ title: 'Подбор', message: 'Укажите название' });
      return;
    }
    const priceNum = price.trim() ? parseNonNegativeNumber(price) : 0;
    const allowanceNum = allowance.trim() ? parseNonNegativeNumber(allowance) : null;
    if (priceNum === null || (allowance.trim() && allowanceNum === null)) {
      showActionConfirm({ title: 'Подбор', message: 'Цена и лимит — числа от 0, например 1 250,50' });
      return;
    }
    // Цена/лимит — деньги, не могут быть отрицательными или абсурдно большими.
    // Зеркалит server-side ge=0, le=10_000_000 в SelectionIn (selections.py).
    if (priceNum < 0 || priceNum > 10_000_000 || (allowanceNum != null && (allowanceNum < 0 || allowanceNum > 10_000_000))) {
      showActionConfirm({ title: 'Подбор', message: 'Цена и лимит должны быть от 0 до 10 000 000 ₽' });
      return;
    }
    setBusy(true);
    try {
      await api.createSelection(user.id, activeProject.id, {
        title: title.trim(),
        category: filter === 'all' ? 'other' : filter,
        price: priceNum,
        allowance: allowanceNum,
      });
      setTitle('');
      setPrice('');
      setAllowance('');
      setShowAdd(false);
      reload();
    } catch (e: unknown) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Позиция подбора');
        setShowAdd(false);
      } else {
        notifyError('Ошибка', e, 'Не удалось добавить позицию');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
      <Text style={s.hint}>
        Подбор чистовых материалов: исполнитель предлагает — заказчик согласует. Лимит — предельная цена позиции.
      </Text>

      {pending > 0 && isCustomer ? (
        <InfoBanner tone="warning" title={`${pending} на согласовании`} message="Примите или отклоните позиции подбора." />
      ) : null}

      {!isCustomer && items.some((i) => i.status === 'approved') ? (
        <PrimaryButton
          title="Согласованные → Материалы / закупки"
          variant="outline"
          onPress={() => pushOsNav(repairTabRoute(role, 'materials'), pathname)}
        />
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips}>
        {CATEGORIES.map((c) => (
          <Pressable key={c.key} style={[s.chip, filter === c.key && s.chipOn]} onPress={() => setFilter(c.key)}>
            <Text style={[s.chipT, filter === c.key && s.chipTOn]}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {canWrite && (
        showAdd ? (
          <View style={s.addBox}>
            <TextInput style={s.inp} placeholder="Название / SKU" value={title} onChangeText={setTitle} />
            <TextInput style={s.inp} placeholder="Цена, ₽" value={price} onChangeText={setPrice} keyboardType="numeric" />
            <TextInput style={s.inp} placeholder="Предельная цена (лимит), ₽" value={allowance} onChangeText={setAllowance} keyboardType="numeric" />
            <PrimaryButton title={busy ? '…' : 'Сохранить'} onPress={createItem} disabled={busy} />
            <PrimaryButton title="Отмена" variant="ghost" onPress={() => setShowAdd(false)} />
          </View>
        ) : (
          <PrimaryButton title="Предложить позицию" variant="outline" onPress={() => setShowAdd(true)} />
        )
      )}

      {!filtered.length ? (
        <EmptyActionState
          title="Подбор пуст"
          hint={selfManaged ? 'Добавьте варианты плитки, сантехники, света и т.д. — после согласования они попадут в закупки.' : 'Исполнитель добавляет варианты плитки, сантехники, света и т.д.'}
          actionLabel={canWrite ? 'Предложить позицию' : isCustomer ? 'Написать в чат' : undefined}
          onAction={
            canWrite
              ? () => setShowAdd(true)
              : isCustomer
                ? () => pushOsNav(tabsRoute(role, 'chat'), pathname, role)
                : undefined
          }
        />
      ) : null}

      {filtered.map((item) => (
        <View key={item.id} style={s.card}>
          <Text style={s.cardTitle}>{item.title}</Text>
          <Text style={s.meta}>{roomName(item.room_id)} · {CATEGORIES.find((c) => c.key === item.category)?.label || item.category}</Text>
          <Text style={s.meta}>
            {formatRub(item.price)}
            {item.allowance != null ? ` / лимит ${formatRub(item.allowance)}` : ''}
          </Text>
          {item.over_allowance ? (
            <Text style={s.warn}>Цена выше лимита</Text>
          ) : null}
          <Text style={s.badge}>{STATUS_LABEL[item.status] || item.status}</Text>

          {canWrite && item.status === 'draft' && (
            <PrimaryButton title="На согласование" compact onPress={async () => {
              try {
                await api.proposeSelection(user.id, activeProject.id, item.id);
                await syncProjectSideEffects({ user, project: activeProject });
                reload();
                alertSelectionProposed(role);
              } catch (e: unknown) {
                failWrite(e, 'Отправка на согласование', 'Не удалось отправить на согласование', 'components.screens.OsSelectionsScreen.Propose');
              }
            }} />
          )}
          {canWrite && item.status === 'rejected' && (
            <PrimaryButton title="Отправить снова" variant="outline" compact onPress={async () => {
              try {
                await api.proposeSelection(user.id, activeProject.id, item.id);
                await syncProjectSideEffects({ user, project: activeProject });
                reload();
                alertSelectionProposed(role);
              } catch (e: unknown) {
                failWrite(e, 'Повторная отправка', 'Не удалось отправить снова', 'components.screens.OsSelectionsScreen.Repropose');
              }
            }} />
          )}

          {isCustomer && !readOnly && item.status === 'proposed' && (
            <View style={s.actions}>
              <PrimaryButton title="Согласовать" compact onPress={() => {
                // Clarity V: зеркало reject — confirm перед approve
                showActionConfirm({
                  title: 'Согласовать подбор?',
                  message: selectionApproveMessage({
                    title: item.title,
                    selfManaged,
                    price: item.price,
                    allowance: item.allowance,
                    overAllowance: item.over_allowance,
                    formatMoney: formatRub,
                  }),
                  primaryLabel: 'Согласовать',
                  onPrimary: () => {
                    void (async () => {
                      try {
                        await api.approveSelection(user.id, activeProject.id, item.id);
                        await syncProjectSideEffects({ user, project: activeProject });
                        reload();
                        alertSelectionApproved(role);
                      } catch (e: unknown) {
                        failWrite(e, 'Согласование', 'Не удалось согласовать', 'components.screens.OsSelectionsScreen.Approve');
                      }
                    })();
                  },
                  secondaryLabel: 'Отмена',
                  onSecondary: () => undefined,
                });
              }} />
              <PrimaryButton title="Отклонить" variant="outline" compact onPress={() => setRejectTarget(item)} />
            </View>
          )}
        </View>
      ))}
      <ReasonSheet
        visible={rejectTarget !== null}
        title={`Отклонить: ${rejectTarget?.title || 'позиция'}`}
        placeholder="Почему отклоняете (обязательно)…"
        hint="Опишите причину — исполнитель увидит её и предложит другой вариант."
        confirmLabel="Отклонить"
        onClose={() => setRejectTarget(null)}
        onConfirm={async (reason) => {
          const target = rejectTarget;
          if (!target) return true;
          try {
            await api.rejectSelection(user.id, activeProject.id, target.id, reason);
            await syncProjectSideEffects({ user, project: activeProject });
            reload();
            showActionConfirm({
              title: 'Позиция отклонена',
              message: 'Исполнитель увидит причину и сможет предложить другой вариант.',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
            return true;
          } catch (e: unknown) {
            if (isOfflineQueued(e)) {
              notifyOfflineQueued('Отклонение', role);
              return true;
            }
            reportError('components.screens.OsSelectionsScreen.Reject', e);
            notifyError('Не удалось отклонить', e, 'Повторите попытку.');
            return false;
          }
        }}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 10 },
  chips: { marginBottom: 10, maxHeight: 40 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: RenovaTheme.colors.border, marginRight: 8, backgroundColor: RenovaTheme.colors.surface },
  chipOn: { borderColor: RenovaTheme.colors.text, backgroundColor: RenovaTheme.colors.borderLight },
  chipT: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  chipTOn: { color: RenovaTheme.colors.text, fontWeight: '600' },
  addBox: { ...listRowStyles.metricCell, alignItems: 'stretch', gap: 8, marginBottom: 12, padding: 12 },
  inp: { borderWidth: StyleSheet.hairlineWidth, borderColor: RenovaTheme.colors.border, borderRadius: 10, padding: 12, fontSize: 15 },
  empty: { marginBottom: 12 },
  emptyT: { ...screenTypography.listTitle },
  emptyM: { ...screenTypography.empty, marginTop: 6 },
  card: { ...listRowStyles.row, gap: 6 },
  cardTitle: { ...screenTypography.listTitle },
  meta: { ...screenTypography.listMeta },
  warn: { fontSize: 12, color: RenovaTheme.colors.warning, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.primary },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
