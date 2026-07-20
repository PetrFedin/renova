/** Sheet детали подбора материала — паттерн как ExpenseDetailSheet */
import { Modal, View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { router, usePathname } from 'expo-router';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api, type MaterialPick, type Room, type Stage } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import type { OsRole } from '@/constants/osSections';
import { MATERIAL_PICK_STATUS_LABEL } from '@/constants/labels';
import { pushRoomDetail, pushStageDetail } from '@/lib/navigation';
import { findDeliveredPurchaseForPick } from '@/lib/domain/findPurchaseForPick';
import { purchaseAdvanceLabel, purchaseCancelStatus } from '@/lib/domain/purchaseLifecycle';
import type { Purchase } from '@/lib/api';

export function MaterialPickDetailSheet({
  pick,
  userId,
  projectId,
  rooms,
  stages,
  role,
  readOnly,
  purchases = [],
  onClose,
  onChanged,
}: {
  pick: MaterialPick | null;
  userId: string;
  projectId: string;
  rooms: Room[];
  stages: Stage[];
  role: OsRole;
  readOnly?: boolean;
  purchases?: Purchase[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { user, activeProject } = useRenova();
  if (!pick) return null;

  const pathname = usePathname();
  const room = rooms.find((r) => r.id === pick.room_id);
  const stage = stages.find((st) => st.id === pick.stage_id);
  const isCustomer = role === 'customer';
  const isContractor = role === 'contractor';
  const deliveredPurchase = pick ? findDeliveredPurchaseForPick(purchases, pick.id) : null;
  const cancelStatus = deliveredPurchase ? purchaseCancelStatus(deliveredPurchase.status) : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.head}>{pick.name}</Text>
          <Text style={s.status}>{MATERIAL_PICK_STATUS_LABEL[pick.status] || pick.status}</Text>

          <View style={s.block}>
            <View style={s.row}><Text style={s.label}>Кол-во</Text><Text style={s.val}>{pick.qty} {pick.unit}</Text></View>
            <View style={s.row}><Text style={s.label}>Цена</Text><Text style={s.val}>{formatRub(pick.price)}</Text></View>
            <View style={s.row}><Text style={s.label}>Итого</Text><Text style={s.val}>{formatRub(pick.total)}</Text></View>
            <View style={s.row}><Text style={s.label}>Кто платит</Text><Text style={s.val}>Подрядчик</Text></View>
            {pick.work_type ? <View style={s.row}><Text style={s.label}>Тип работ</Text><Text style={s.val}>{pick.work_type}</Text></View> : null}
          </View>

          {room && (
            <Pressable style={s.linkRow} onPress={() => { onClose(); pushRoomDetail(room.id, pathname); }}>
              <Text style={s.label}>Комната</Text>
              <Text style={s.link}>{room.name} →</Text>
            </Pressable>
          )}
          {stage && (
            <Pressable style={s.linkRow} onPress={() => { onClose(); pushStageDetail(stage.id, pathname); }}>
              <Text style={s.label}>Этап</Text>
              <Text style={s.link}>{stage.name} →</Text>
            </Pressable>
          )}
          {pick.shop_url && (
            <Pressable style={s.linkRow} onPress={() => Linking.openURL(pick.shop_url!)}>
              <Text style={s.label}>Магазин</Text>
              <Text style={s.link}>{pick.shop_name || 'Открыть ссылку'} →</Text>
            </Pressable>
          )}

          {pick.status === 'approved' && (
            <Text style={s.note}>Согласовано — в факт бюджета попадёт после «Куплено». Оплата: подрядчик.</Text>
          )}
          {pick.status === 'purchased' && (
            <Text style={s.note}>Оплата: подрядчик · учтено в факте. «Убрать из факта» — отмена доставки закупки.</Text>
          )}
          {pick.status === 'pending' && isCustomer && (
            <Text style={s.note}>После согласования подрядчик отметит покупку — тогда сумма войдёт в факт.</Text>
          )}

          {!readOnly && isCustomer && pick.status === 'pending' && (
            <PrimaryButton title="Согласовать" onPress={async () => {
              await api.approveMaterialPick(userId, projectId, pick.id);
              await syncProjectSideEffects({
                user: user ?? ({ id: userId } as any),
                project: activeProject ?? ({ id: projectId } as any),
                role,
              });
              onChanged?.();
              onClose();
            }} />
          )}
          {!readOnly && isContractor && pick.status === 'draft' && (
            <PrimaryButton title="На согласование" variant="outline" onPress={async () => {
              await api.submitMaterialPick(userId, projectId, pick.id);
              onChanged?.();
              onClose();
            }} />
          )}
          {!readOnly && cancelStatus && deliveredPurchase && (
            <PrimaryButton
              title={purchaseAdvanceLabel(cancelStatus)}
              variant="outline"
              onPress={async () => {
                await api.updatePurchaseStatus(userId, projectId, deliveredPurchase.id, cancelStatus);
                await syncProjectSideEffects({
                  user: user ?? ({ id: userId } as any),
                  project: activeProject ?? ({ id: projectId } as any),
                  role,
                });
                onChanged?.();
                onClose();
              }}
            />
          )}

          <PrimaryButton
            title="Полная карточка"
            variant="outline"
            onPress={() => {
              onClose();
              router.push({ pathname: '/material/[id]', params: { id: pick.id, returnTo: pathname } } as any);
            }}
          />
          <PrimaryButton title="Закрыть" variant="outline" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: RenovaTheme.colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 },
  head: { fontSize: 17, fontWeight: '800' },
  status: { fontSize: 13, color: RenovaTheme.colors.primary, fontWeight: '600', marginBottom: 12 },
  block: { ...card, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: 12, color: RenovaTheme.colors.textMuted, fontWeight: '600' },
  val: { fontSize: 14, fontWeight: '600' },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  link: { fontSize: 14, color: RenovaTheme.colors.primary, fontWeight: '600' },
  note: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 10 },
});
