/** Sheet детали подбора материала — паттерн как ExpenseDetailSheet */
import { useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { usePathname } from 'expo-router';
import { pushOsNav } from '@/lib/pushOsNav';
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
import {
  alertMaterialPickApproved,
  alertMaterialPickSubmitted,
} from '@/lib/procurementNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { resolveSafeDocumentUrl } from '@/lib/documentUrl';

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
  const pathname = usePathname();
  const [busyAction, setBusyAction] = useState<'approve' | 'submit' | 'rollback' | null>(null);

  if (!pick) return null;

  const room = rooms.find((r) => r.id === pick.room_id);
  const stage = stages.find((st) => st.id === pick.stage_id);
  const isCustomer = role === 'customer';
  const isContractor = role === 'contractor';
  const deliveredPurchase = findDeliveredPurchaseForPick(purchases, pick.id);
  const cancelStatus = deliveredPurchase ? purchaseCancelStatus(deliveredPurchase.status) : null;
  const busy = busyAction !== null;
  const closeSafely = () => {
    if (!busy) onClose();
  };

  const syncAfterMutation = async () => {
    await syncProjectSideEffects({
      user: user ?? ({ id: userId } as any),
      project: activeProject ?? ({ id: projectId } as any),
      role,
    });
    onChanged?.();
  };

  const openShop = async () => {
    if (busy) return;
    const safeUrl = resolveSafeDocumentUrl(pick.shop_url);
    if (!safeUrl) {
      showActionConfirm({
        title: 'Ссылка недоступна',
        message: 'Адрес магазина пустой или использует небезопасный формат.',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
      return;
    }
    try {
      await Linking.openURL(safeUrl);
    } catch {
      showActionConfirm({
        title: 'Не удалось открыть магазин',
        message: 'Проверьте ссылку или попробуйте позже.',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
    }
  };

  const approve = () => {
    if (busy) return;
    showActionConfirm({
      title: 'Согласовать материал?',
      message: `«${pick.name}» · ${formatRub(pick.price)}. После согласия подрядчик сможет закупить.`,
      primaryLabel: 'Согласовать',
      onPrimary: () => {
        void (async () => {
          if (busyAction) return;
          setBusyAction('approve');
          try {
            await api.approveMaterialPick(userId, projectId, pick.id);
            await syncAfterMutation();
            onClose();
            alertMaterialPickApproved(role);
          } catch (e: unknown) {
            showActionConfirm({
              title: 'Ошибка',
              message: e instanceof Error ? e.message : 'Не удалось согласовать',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
          } finally {
            setBusyAction(null);
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const submit = async () => {
    if (busy) return;
    setBusyAction('submit');
    try {
      await api.submitMaterialPick(userId, projectId, pick.id);
      await syncAfterMutation();
      onClose();
      alertMaterialPickSubmitted(role);
    } catch (e: unknown) {
      showActionConfirm({
        title: 'Ошибка',
        message: e instanceof Error ? e.message : 'Не удалось отправить на согласование',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const rollbackFact = () => {
    if (busy || !cancelStatus || !deliveredPurchase) return;
    showActionConfirm({
      title: 'Убрать закупку из факта?',
      message: 'Сумма будет исключена из факта бюджета, а статус доставки изменится. Операцию можно восстановить позже через закупку.',
      primaryLabel: 'Убрать из факта',
      primaryDestructive: true,
      onPrimary: () => {
        void (async () => {
          if (busyAction) return;
          setBusyAction('rollback');
          try {
            await api.updatePurchaseStatus(userId, projectId, deliveredPurchase.id, cancelStatus);
            await syncAfterMutation();
            onClose();
          } catch (e: unknown) {
            showActionConfirm({
              title: 'Ошибка',
              message: e instanceof Error ? e.message : 'Не удалось обновить закупку',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
          } finally {
            setBusyAction(null);
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={closeSafely}>
      <Pressable style={s.backdrop} onPress={closeSafely}>
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
            <Pressable
              style={s.linkRow}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Открыть комнату ${room.name}`}
              onPress={() => { onClose(); pushRoomDetail(room.id, pathname); }}
            >
              <Text style={s.label}>Комната</Text>
              <Text style={s.link}>{room.name} →</Text>
            </Pressable>
          )}
          {stage && (
            <Pressable
              style={s.linkRow}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Открыть этап ${stage.name}`}
              onPress={() => { onClose(); pushStageDetail(stage.id, pathname); }}
            >
              <Text style={s.label}>Этап</Text>
              <Text style={s.link}>{stage.name} →</Text>
            </Pressable>
          )}
          {pick.shop_url && (
            <Pressable
              style={s.linkRow}
              disabled={busy}
              accessibilityRole="link"
              accessibilityLabel={`Открыть магазин ${pick.shop_name || pick.name}`}
              onPress={() => { void openShop(); }}
            >
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
            <PrimaryButton
              title="Согласовать"
              onPress={approve}
              loading={busyAction === 'approve'}
              disabled={busy && busyAction !== 'approve'}
            />
          )}
          {!readOnly && isContractor && pick.status === 'draft' && (
            <PrimaryButton
              title="На согласование"
              variant="outline"
              onPress={() => { void submit(); }}
              loading={busyAction === 'submit'}
              disabled={busy && busyAction !== 'submit'}
            />
          )}
          {!readOnly && cancelStatus && deliveredPurchase && (
            <PrimaryButton
              title={purchaseAdvanceLabel(cancelStatus)}
              variant="dangerOutline"
              onPress={rollbackFact}
              loading={busyAction === 'rollback'}
              disabled={busy && busyAction !== 'rollback'}
            />
          )}

          <PrimaryButton
            title="Полная карточка"
            variant="outline"
            disabled={busy}
            onPress={() => {
              onClose();
              pushOsNav(
                { pathname: '/material/[id]', params: { id: pick.id } },
                pathname,
                role,
              );
            }}
          />
          <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} />
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
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: RenovaTheme.minTouch, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  link: { fontSize: 14, color: RenovaTheme.colors.primary, fontWeight: '600' },
  note: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 10 },
});
