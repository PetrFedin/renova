import { formatDecimal } from '@/lib/formatDecimal';
import { formatScheduleDayFull } from '@/lib/formatScheduleDate';
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { api, WasteOrder } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { alertWasteOrderAdvanced } from '@/lib/siteOpsNav';
import type { OsRole } from '@/constants/osSections';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { reportCatch } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { writeResultMessage } from '@/lib/offlineResultMessage';
import { WASTE_STATUS_LABEL, parseWasteForm, wasteActions, wasteDateLabel } from '@/lib/domain/wasteOrderPolicy';
import { useWriteAllowed } from '@/components/renova/ReadOnlyGuard';

/** W114: UI офлайн для вывоза мусора (API уже в offlineQueue) */
async function runWasteAction(
  label: string,
  action: () => Promise<unknown>,
  after: () => Promise<void> | void,
) {
  try {
    await action();
    await after();
  } catch (e) {
    if (isOfflineQueued(e)) {
      notifyOfflineQueued(label);
      await after();
      return;
    }
    showActionConfirm({
      title: 'Ошибка',
      message: writeResultMessage(e, 'Не удалось выполнить действие'),
    });
  }
}

export function WasteOrderList({ userId, projectId, role }: { userId: string; projectId: string; role: string }) {
  const { user, activeProject } = useRenova();
  const canWrite = useWriteAllowed();
  // APIB-012: без исполнителя в проекте заказчик сам заказывает и закрывает вывоз.
  const selfManaged = activeProject?.id === projectId && !activeProject?.contractor_id;
  const syncAfter = () => syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject ?? ({ id: projectId } as any), role });
  const [items, setItems] = useState<WasteOrder[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [volumeText, setVolumeText] = useState('8');
  const [priceText, setPriceText] = useState('');
  const [notesText, setNotesText] = useState('');
  const load = useCallback(() => {
    api.listWasteOrders(userId, projectId).then(setItems).catch(reportCatch('components.renova.WasteOrderList.1'));
  }, [userId, projectId]);
  useEffect(() => { load(); }, [load]);
  useProjectDataReload(load);
  const form = parseWasteForm(volumeText, priceText);
  const canCreate = canWrite && wasteActions(role, selfManaged, 'draft').create;

  const confirmCancel = (w: WasteOrder) => {
    showActionConfirm({
      title: 'Отменить вывоз?',
      message: `${formatDecimal(w.volume_m3)} м³ · ${formatRub(w.total || 0)}. Заявка будет закрыта, расход не появится.`,
      primaryLabel: 'Отменить вывоз',
      primaryDestructive: true,
      onPrimary: () => {
        void runWasteAction(
          'Отмена вывоза',
          () => api.cancelWasteOrder(userId, projectId, w.id),
          async () => { await syncAfter(); load(); },
        );
      },
      secondaryLabel: 'Назад',
      onSecondary: () => undefined,
    });
  };

  return (
    <View style={s.box}>
      <Text style={s.head}>Вывоз мусора</Text>
      {items.length === 0 ? <Text style={s.m}>Заявок на вывоз пока нет.</Text> : null}
      {items.map(w => {
        const act = wasteActions(role, selfManaged, w.status);
        return (
        <View key={w.id} style={s.row}>
          <Text style={s.n}>{formatDecimal(w.volume_m3)} м³ · {WASTE_STATUS_LABEL[w.status] ?? 'Статус уточняется'}</Text>
          <Text style={s.m}>{formatRub(w.total || 0)}{w.price ? ` · ${formatRub(w.price)} за м³` : ''}</Text>
          {wasteDateLabel(w, formatScheduleDayFull) ? <Text style={s.m}>{wasteDateLabel(w, formatScheduleDayFull)}</Text> : null}
          {canWrite && act.request && (
            <PrimaryButton
              title="Заказать"
              variant="outline"
              onPress={() => runWasteAction('Заказ вывоза', () => api.requestWasteOrder(userId, projectId, w.id), async () => { await syncAfter(); load(); alertWasteOrderAdvanced(role as OsRole, 'requested'); })}
            />
          )}
          {canWrite && act.approve && (
            <PrimaryButton
              title="Согласовать"
              onPress={() => {
                // Clarity W: money/obligation — pre-confirm перед approve
                showActionConfirm({
                  title: 'Согласовать вывоз?',
                  message: `${formatDecimal(w.volume_m3)} м³ · ${formatRub(w.total || 0)}. Расход попадёт в бюджет, когда вывоз будет отмечен выполненным.`,
                  primaryLabel: 'Согласовать',
                  onPrimary: () => {
                    void runWasteAction(
                      'Согласование вывоза',
                      () => api.approveWasteOrder(userId, projectId, w.id),
                      async () => {
                        await syncAfter();
                        load();
                        alertWasteOrderAdvanced(role as OsRole, 'approved');
                      },
                    );
                  },
                  secondaryLabel: 'Отмена',
                  onSecondary: () => undefined,
                });
              }}
            />
          )}
          {canWrite && act.complete && (
            <PrimaryButton
              title="Вывезено"
              onPress={() => runWasteAction('Завершение вывоза', () => api.completeWasteOrder(userId, projectId, w.id), async () => { await syncAfter(); load(); alertWasteOrderAdvanced(role as OsRole, 'completed'); })}
            />
          )}
          {canWrite && act.cancel && (
            <PrimaryButton title="Отменить вывоз" variant="dangerOutline" onPress={() => confirmCancel(w)} />
          )}
        </View>
        );
      })}
      {canCreate && showForm && (
        <View style={s.form}>
          <TextInput accessibilityLabel="Объём вывоза, м³" style={s.inp} placeholder="Объём, м³" value={volumeText} onChangeText={setVolumeText} keyboardType="decimal-pad" />
          <TextInput accessibilityLabel="Цена за 1 м³" style={s.inp} placeholder="Цена за 1 м³, ₽" value={priceText} onChangeText={setPriceText} keyboardType="decimal-pad" />
          <TextInput accessibilityLabel="Комментарий" style={s.inp} placeholder="Комментарий (необязательно)" value={notesText} onChangeText={setNotesText} />
          <Text style={s.m}>{form.ok ? `Итого: ${formatRub(form.total)} (${form.volume_m3} м³ × ${formatRub(form.price)})` : form.message}</Text>
          <PrimaryButton
            title="Создать заявку"
            disabled={!form.ok}
            onPress={() => {
              if (!form.ok) return;
              void runWasteAction(
                'Заявка на вывоз',
                () => api.createWasteOrder(userId, projectId, {
                  volume_m3: form.volume_m3,
                  price: form.price,
                  waste_type: 'construction',
                  notes: notesText.trim() || null,
                }),
                async () => { setShowForm(false); setNotesText(''); await syncAfter(); load(); alertWasteOrderAdvanced(role as OsRole, 'created'); },
              );
            }}
          />
          <PrimaryButton title="Отмена" variant="outline" onPress={() => setShowForm(false)} />
        </View>
      )}
      {canCreate && !showForm && (
        <PrimaryButton title="+ Заявка на вывоз" variant="outline" onPress={() => setShowForm(true)} />
      )}
    </View>
  );
}
const s = StyleSheet.create({
  box: { marginVertical: 10 },
  head: { fontWeight: '800', marginBottom: 8 },
  row: { backgroundColor: RenovaTheme.colors.surface, padding: 10, borderRadius: 8, marginBottom: 6 },
  n: { fontWeight: '600' },
  m: { fontSize: 12, color: '#666' },
  form: { gap: 8, marginTop: 8 },
  inp: {
    minHeight: RenovaTheme.minTouch,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: RenovaTheme.colors.surface,
    color: RenovaTheme.colors.text,
  },
});
