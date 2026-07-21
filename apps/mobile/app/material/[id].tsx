/** Деталь материала — подбор / закупка */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Linking, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api, MaterialPick, Purchase } from '@/lib/api';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { repairTabRoute } from '@/constants/osSections';
import { findDeliveredPurchaseForPick } from '@/lib/domain/findPurchaseForPick';
import { purchaseAdvanceLabel, purchaseCancelStatus } from '@/lib/domain/purchaseLifecycle';

const ST: Record<string, string> = {
  draft: 'Черновик', pending: 'На согласовании', approved: 'Согласовано', purchased: 'Куплено', rejected: 'Отклонено',
};

export default function MaterialDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const [pick, setPick] = useState<MaterialPick | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
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
      api.listPurchases(user.id, activeProject.id).catch(() => [] as Purchase[]),
    ]).then(([items, pu]) => {
      setPurchases(pu);
      setPick(items.find((p) => p.id === id) || null);
    }).catch(() => { setPick(null); setPurchases([]); }).finally(() => setLoading(false));
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

  return (
    <>
      <BackHeader title={pick.name} returnTo={returnTo} subtitle={ST[pick.status] || pick.status} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={s.card}>
          <Text style={s.row}><Text style={s.label}>Кол-во</Text> {pick.qty} {pick.unit}</Text>
          <Text style={s.row}><Text style={s.label}>Цена</Text> {formatRub(pick.price)} · итого {formatRub(pick.total)}</Text>
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
        {pick.status === 'approved' && (
          <Text style={s.hint}>Согласовано, но в факт бюджета попадёт только после «Куплено» подрядчиком.</Text>
        )}
        {pick.status === 'purchased' && (
          <Text style={s.hint}>Оплата: подрядчик · учтено в факте бюджета.</Text>
        )}
        {pick.status === 'purchased' && deliveredPurchase && cancelStatus && role === 'contractor' && user && activeProject && (
          <PrimaryButton title={purchaseAdvanceLabel(cancelStatus)} variant="outline" onPress={async () => {
            await api.updatePurchaseStatus(user.id, activeProject.id, deliveredPurchase.id, cancelStatus);
            await syncProjectSideEffects({ user, project: activeProject });
            reload();
          }} />
        )}
        {role === 'customer' && pick.status === 'pending' && user && activeProject && (
          <PrimaryButton title="Согласовать" onPress={async () => { await api.approveMaterialPick(user.id, activeProject.id, pick.id); await syncProjectSideEffects({ user, project: activeProject }); reload(); }} />
        )}
        {role === 'contractor' && pick.status === 'draft' && user && activeProject && (
          <PrimaryButton title="На согласование" onPress={async () => { await api.submitMaterialPick(user.id, activeProject.id, pick.id); await syncProjectSideEffects({ user, project: activeProject }); reload(); }} />
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
});
