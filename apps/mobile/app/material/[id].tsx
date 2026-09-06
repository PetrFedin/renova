/** Деталь материала — подбор / закупка */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Linking, Pressable, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { alertMaterialPickApproved, alertMaterialPickSubmitted } from '@/lib/procurementNav';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { reportError } from '@/lib/reportError';
import { api, MaterialPick, Purchase } from '@/lib/api';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { repairTabRoute } from '@/constants/osSections';
import { findDeliveredPurchaseForPick } from '@/lib/domain/findPurchaseForPick';
import { purchaseAdvanceLabel, purchaseCancelStatus } from '@/lib/domain/purchaseLifecycle';

const ST: Record<string, string> = {
  draft: 'Черновик', pending: 'На согласовании', approved: 'Согласовано', purchased: 'Куплено', rejected: 'Отклонено',
};

function priceTruthLabel(pick: MaterialPick): string {
  if (pick.price_source === 'manual') return 'Цена указана вручную';
  if (pick.price_source?.startsWith('live_')) {
    if (pick.price_verified_at) {
      const parsed = new Date(pick.price_verified_at);
      const when = Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString('ru-RU');
      return when ? `Цена проверена по поставщику · ${when}` : 'Цена проверена по поставщику';
    }
    return 'Цена проверена по поставщику';
  }
  if (pick.price_source === 'legacy_unknown') return 'Историческая цена: происхождение не подтверждено';
  if (pick.price_source === 'unset') return 'Цена не указана';
  return 'Происхождение цены не загружено';
}

export default function MaterialDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const [pick, setPick] = useState<MaterialPick | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [priceTruthError, setPriceTruthError] = useState(false);
  const [manualPrice, setManualPrice] = useState('');
  const [priceBusy, setPriceBusy] = useState(false);
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';

  const reload = useCallback(() => {
    if (!user || !activeProject || !id) {
      setLoading(false);
      setPick(null);
      return;
    }
    setLoading(true);
    Promise.all([
      api.listMaterialPicks(user.id, activeProject.id),
      api.listPurchases(user.id, activeProject.id).catch((error) => {
        reportError('material.detail.purchases', error, { projectId: activeProject.id, materialId: id });
        return [] as Purchase[];
      }),
      api.getMaterialPriceTruth(user.id, activeProject.id, id).catch((error) => {
        reportError('material.detail.priceTruth', error, { projectId: activeProject.id, materialId: id });
        return null;
      }),
    ]).then(([items, pu, truth]) => {
      setPurchases(pu);
      const base = items.find((p) => p.id === id) || null;
      const merged = base && truth ? { ...base, ...truth } : base;
      setPick(merged);
      setPriceTruthError(Boolean(base && !truth));
      if (merged) setManualPrice(String(merged.price || ''));
    }).catch((error) => {
      reportError('material.detail.reload', error, { projectId: activeProject.id, materialId: id });
      setPick(null);
      setPurchases([]);
      setPriceTruthError(true);
    }).finally(() => setLoading(false));
  }, [user?.id, activeProject?.id, id]);

  useEffect(() => { reload(); }, [reload]);
  useProjectDataReload(reload);

  if (loading) {
    return (
      <>
        <BackHeader title="Материал" returnTo={returnTo} />
        <View style={s.center}><Text>Загрузка…</Text></View>
      </>
    );
  }

  if (!pick) {
    return (
      <>
        <BackHeader title="Материал" returnTo={returnTo} />
        <View style={s.center}><Text>Материал не найден</Text></View>
      </>
    );
  }

  const room = activeProject?.rooms?.find((r) => r.id === pick.room_id);
  const stage = activeProject?.stages?.find((st) => st.id === pick.stage_id);
  const deliveredPurchase = findDeliveredPurchaseForPick(purchases, pick.id);
  const cancelStatus = deliveredPurchase ? purchaseCancelStatus(deliveredPurchase.status) : null;
  const priceNeedsConfirmation = pick.price_actionable === false || pick.price_source === 'legacy_unknown' || pick.price_source === 'unset';
  const priceCanEdit = pick.status === 'draft' || (pick.status === 'approved' && priceNeedsConfirmation);

  const saveManualPrice = async () => {
    if (!user || !activeProject || priceBusy) return;
    const value = Number(manualPrice.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      showActionConfirm({ title: 'Проверьте цену', message: 'Укажите корректную сумму в рублях.' });
      return;
    }
    setPriceBusy(true);
    try {
      const updated = await api.setMaterialPrice(user.id, activeProject.id, pick.id, value);
      setPick((current) => current ? { ...current, ...updated } : updated);
      setManualPrice(String(updated.price || ''));
      setPriceTruthError(false);
      await syncProjectSideEffects({ user, project: activeProject });
    } catch (e: unknown) {
      reportError('material.detail.setPrice', e, { projectId: activeProject.id, materialId: pick.id });
      showActionConfirm({
        title: 'Цена не сохранена',
        message: e instanceof Error ? e.message : 'Проверьте данные и повторите.',
      });
    } finally {
      setPriceBusy(false);
    }
  };

  const verifySupplierPrice = async () => {
    if (!user || !activeProject || priceBusy || !pick.shop_url) return;
    setPriceBusy(true);
    try {
      const updated = await api.syncMaterialPrice(user.id, activeProject.id, pick.id);
      setPick((current) => current ? { ...current, ...updated } : updated);
      setManualPrice(String(updated.price || ''));
      setPriceTruthError(false);
      if (!updated.price_verified) {
        showActionConfirm({
          title: 'Цена не подтверждена',
          message: 'Поставщик не отдал доказуемую цену. Сохранённое значение не изменено.',
        });
      }
    } catch (e: unknown) {
      reportError('material.detail.verifyPrice', e, { projectId: activeProject.id, materialId: pick.id });
      showActionConfirm({
        title: 'Цена не проверена',
        message: e instanceof Error ? e.message : 'Не удалось проверить цену поставщика.',
      });
    } finally {
      setPriceBusy(false);
    }
  };

  return (
    <>
      <BackHeader title={pick.name} returnTo={returnTo} subtitle={ST[pick.status] || pick.status} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={s.card}>
          <Text style={s.row}><Text style={s.label}>Кол-во</Text> {pick.qty} {pick.unit}</Text>
          <Text style={s.row}><Text style={s.label}>Цена</Text> {formatRub(pick.price)} · итого {formatRub(pick.total)}</Text>
          <Text style={[s.provenance, priceNeedsConfirmation && s.warning]}>{priceTruthLabel(pick)}</Text>
          {priceTruthError && <Text style={s.warning}>Не удалось загрузить подтверждение происхождения цены. Не считайте цену проверенной.</Text>}
          {room && <Text style={s.row}><Text style={s.label}>Комната</Text> {room.name}</Text>}
          {stage && (
            <Pressable onPress={() => pushOsNav({ pathname: '/stage/[id]', params: { id: stage.id } }, `/material/${pick.id}`)}>
              <Text style={s.row}><Text style={s.label}>Этап</Text> <Text style={s.link}>{stage.name}</Text></Text>
            </Pressable>
          )}
          {pick.shop_url && (
            <Pressable onPress={() => Linking.openURL(pick.shop_url!)}>
              <Text style={s.link}>{pick.shop_name || pick.shop_url}</Text>
            </Pressable>
          )}
        </View>
        {priceCanEdit && user && activeProject && (
          <View style={s.priceEditor}>
            <Text style={s.editorTitle}>{priceNeedsConfirmation ? 'Подтвердите цену перед закупкой' : 'Уточнить цену'}</Text>
            <TextInput
              accessibilityLabel="Цена материала в рублях"
              style={s.input}
              value={manualPrice}
              onChangeText={setManualPrice}
              keyboardType="decimal-pad"
              editable={!priceBusy}
              placeholder="Цена, ₽"
            />
            <PrimaryButton title="Сохранить цену вручную" loading={priceBusy} disabled={priceBusy} onPress={() => { void saveManualPrice(); }} />
            {pick.shop_url && (
              <PrimaryButton title="Проверить по ссылке поставщика" variant="outline" loading={priceBusy} disabled={priceBusy} onPress={() => { void verifySupplierPrice(); }} />
            )}
          </View>
        )}
        {priceNeedsConfirmation && !priceCanEdit && (
          <Text style={s.warning}>Цена не имеет подтверждённого происхождения. Новую закупку по такой позиции система не создаст.</Text>
        )}
        {pick.status === 'approved' && (
          <Text style={s.hint}>Согласовано, но в факт бюджета попадёт только после «Куплено» подрядчиком.</Text>
        )}
        {pick.status === 'purchased' && (
          <Text style={s.hint}>Оплата: подрядчик · учтено в факте бюджета.</Text>
        )}
        {pick.status === 'purchased' && deliveredPurchase && cancelStatus && role === 'contractor' && user && activeProject && (
          <PrimaryButton title={purchaseAdvanceLabel(cancelStatus)} variant="outline" onPress={() => {
            showActionConfirm({
              title: 'Убрать из факта?',
              message: 'Сумма закупки выйдет из факта бюджета. Можно вернуть статус позже.',
              primaryLabel: 'Убрать',
              onPrimary: () => {
                void (async () => {
                  try {
                    await api.updatePurchaseStatus(user.id, activeProject.id, deliveredPurchase.id, cancelStatus);
                    await syncProjectSideEffects({ user, project: activeProject });
                    reload();
                  } catch (e: unknown) {
                    reportError('material.detail.updatePurchase', e, { projectId: activeProject.id, materialId: pick.id, purchaseId: deliveredPurchase.id });
                    showActionConfirm({
                      title: 'Ошибка',
                      message: e instanceof Error ? e.message : 'Не удалось обновить закупку',
                    });
                  }
                })();
              },
              secondaryLabel: 'Отмена',
              onSecondary: () => undefined,
            });
          }} />
        )}
        {role === 'customer' && pick.status === 'pending' && user && activeProject && (
          <PrimaryButton title="Согласовать" onPress={() => {
            showActionConfirm({
              title: 'Согласовать материал?',
              message: 'После согласия подрядчик сможет закупить позицию.',
              primaryLabel: 'Согласовать',
              onPrimary: () => {
                void (async () => {
                  try {
                    await api.approveMaterialPick(user.id, activeProject.id, pick.id);
                    await syncProjectSideEffects({ user, project: activeProject });
                    reload();
                    alertMaterialPickApproved(role);
                  } catch (e: unknown) {
                    reportError('material.detail.approve', e, { projectId: activeProject.id, materialId: pick.id });
                    showActionConfirm({
                      title: 'Ошибка',
                      message: e instanceof Error ? e.message : 'Не удалось согласовать',
                    });
                  }
                })();
              },
              secondaryLabel: 'Отмена',
              onSecondary: () => undefined,
            });
          }} />
        )}
        {role === 'contractor' && pick.status === 'draft' && user && activeProject && (
          <PrimaryButton title="На согласование" onPress={async () => {
            try {
              await api.submitMaterialPick(user.id, activeProject.id, pick.id);
              await syncProjectSideEffects({ user, project: activeProject });
              reload();
              alertMaterialPickSubmitted(role);
            } catch (e: unknown) {
              reportError('material.detail.submit', e, { projectId: activeProject.id, materialId: pick.id });
              showActionConfirm({
                title: 'Не отправлено',
                message: e instanceof Error ? e.message : 'Не удалось отправить материал на согласование.',
              });
            }
          }} />
        )}
        <PrimaryButton title="Все материалы" variant="outline" onPress={() => replaceOsNav(repairTabRoute(role, 'materials'), undefined, role)} />
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { ...card, marginBottom: 12 },
  row: { fontSize: 14, marginBottom: 6 },
  label: { fontWeight: '700', color: RenovaTheme.colors.textMuted },
  link: { color: RenovaTheme.colors.primary, fontWeight: '600', marginTop: 6 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 12 },
  provenance: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 6 },
  warning: { fontSize: 12, color: RenovaTheme.colors.danger, lineHeight: 17, marginBottom: 12 },
  priceEditor: { ...card, gap: 8, marginBottom: 12 },
  editorTitle: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text },
  input: {
    minHeight: RenovaTheme.minTouch,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: RenovaTheme.colors.text,
    backgroundColor: RenovaTheme.colors.surface,
  },
});
