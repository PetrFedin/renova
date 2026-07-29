/** Sheet детали подбора материала — shared operational sheet */
import { useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { usePathname } from 'expo-router';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface, sheetContentStyles } from '@/components/renova/SheetSurface';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { api, type MaterialPick, type Purchase, type Room, type Stage } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import type { OsRole } from '@/constants/osSections';
import { MATERIAL_PICK_STATUS_LABEL } from '@/constants/labels';
import { pushRoomDetail, pushStageDetail } from '@/lib/navigation';
import { pushOsNav } from '@/lib/pushOsNav';
import { findDeliveredPurchaseForPick } from '@/lib/domain/findPurchaseForPick';
import { purchaseAdvanceLabel, purchaseCancelStatus } from '@/lib/domain/purchaseLifecycle';
import { alertMaterialPickApproved, alertMaterialPickSubmitted } from '@/lib/procurementNav';
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
  const mutationRef = useRef(false);

  if (!pick) return null;

  const room = rooms.find((candidate) => candidate.id === pick.room_id);
  const stage = stages.find((candidate) => candidate.id === pick.stage_id);
  const isCustomer = role === 'customer';
  const isContractor = role === 'contractor';
  const deliveredPurchase = findDeliveredPurchaseForPick(purchases, pick.id);
  const cancelStatus = deliveredPurchase ? purchaseCancelStatus(deliveredPurchase.status) : null;
  const busy = busyAction !== null;
  const statusLabel = MATERIAL_PICK_STATUS_LABEL[pick.status] || pick.status;

  const closeSafely = () => {
    if (!mutationRef.current) onClose();
  };

  const beginMutation = (action: Exclude<typeof busyAction, null>): boolean => {
    if (mutationRef.current) return false;
    mutationRef.current = true;
    setBusyAction(action);
    return true;
  };

  const endMutation = () => {
    mutationRef.current = false;
    setBusyAction(null);
  };

  const syncAfterMutation = async () => {
    await syncProjectSideEffects({
      user: user ?? ({ id: userId } as never),
      project: activeProject ?? ({ id: projectId } as never),
      role,
    });
    onChanged?.();
  };

  const openShop = async () => {
    if (mutationRef.current) return;
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
    if (mutationRef.current) return;
    showActionConfirm({
      title: 'Согласовать материал?',
      message: `«${pick.name}» · ${formatRub(pick.price)}. После согласия подрядчик сможет закупить.`,
      primaryLabel: 'Согласовать',
      onPrimary: () => {
        void (async () => {
          if (!beginMutation('approve')) return;
          try {
            await api.approveMaterialPick(userId, projectId, pick.id);
            await syncAfterMutation();
            onClose();
            alertMaterialPickApproved(role);
          } catch (error: unknown) {
            showActionConfirm({
              title: 'Материал не согласован',
              message: error instanceof Error ? error.message : 'Повторите операцию.',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
          } finally {
            endMutation();
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const submit = () => {
    if (mutationRef.current) return;
    showActionConfirm({
      title: 'Отправить материал на согласование?',
      message: `Заказчик получит позицию «${pick.name}» для решения.`,
      primaryLabel: 'Отправить',
      onPrimary: () => {
        void (async () => {
          if (!beginMutation('submit')) return;
          try {
            await api.submitMaterialPick(userId, projectId, pick.id);
            await syncAfterMutation();
            onClose();
            alertMaterialPickSubmitted(role);
          } catch (error: unknown) {
            showActionConfirm({
              title: 'Не отправлено',
              message: error instanceof Error ? error.message : 'Повторите операцию.',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
          } finally {
            endMutation();
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const rollbackFact = () => {
    if (mutationRef.current || !cancelStatus || !deliveredPurchase) return;
    showActionConfirm({
      title: 'Убрать закупку из факта?',
      message: 'Сумма будет исключена из факта бюджета, а статус доставки изменится. Операцию можно восстановить позже через закупку.',
      primaryLabel: 'Убрать из факта',
      primaryDestructive: true,
      onPrimary: () => {
        void (async () => {
          if (!beginMutation('rollback')) return;
          try {
            await api.updatePurchaseStatus(userId, projectId, deliveredPurchase.id, cancelStatus);
            await syncAfterMutation();
            onClose();
          } catch (error: unknown) {
            showActionConfirm({
              title: 'Закупка не изменена',
              message: error instanceof Error ? error.message : 'Повторите операцию.',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
          } finally {
            endMutation();
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  return (
    <SheetSurface
      visible
      value={formatRub(pick.total)}
      title={pick.name}
      subtitle={statusLabel}
      busy={busy}
      onClose={closeSafely}
      accessibilityLabel="Детали материала"
      footer={
        <>
          {!readOnly && isCustomer && pick.status === 'pending' ? (
            <PrimaryButton
              title="Согласовать"
              onPress={approve}
              loading={busyAction === 'approve'}
              disabled={busy && busyAction !== 'approve'}
              fullWidth
            />
          ) : null}
          {!readOnly && isContractor && pick.status === 'draft' ? (
            <PrimaryButton
              title="На согласование"
              variant="outline"
              onPress={submit}
              loading={busyAction === 'submit'}
              disabled={busy && busyAction !== 'submit'}
              fullWidth
            />
          ) : null}
          {!readOnly && cancelStatus && deliveredPurchase ? (
            <PrimaryButton
              title={purchaseAdvanceLabel(cancelStatus)}
              variant="dangerOutline"
              onPress={rollbackFact}
              loading={busyAction === 'rollback'}
              disabled={busy && busyAction !== 'rollback'}
              fullWidth
            />
          ) : null}
          <PrimaryButton
            title="Полная карточка"
            variant="outline"
            disabled={busy}
            onPress={() => {
              onClose();
              pushOsNav({ pathname: '/material/[id]', params: { id: pick.id } }, pathname, role);
            }}
            fullWidth
          />
          <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} fullWidth />
        </>
      }
    >
      <View style={sheetContentStyles.row}>
        <Text style={sheetContentStyles.label}>Количество</Text>
        <Text style={sheetContentStyles.value}>{pick.qty} {pick.unit}</Text>
      </View>
      <View style={sheetContentStyles.row}>
        <Text style={sheetContentStyles.label}>Цена</Text>
        <Text style={sheetContentStyles.value}>{formatRub(pick.price)}</Text>
      </View>
      <View style={sheetContentStyles.row}>
        <Text style={sheetContentStyles.label}>Кто платит</Text>
        <Text style={sheetContentStyles.value}>Подрядчик</Text>
      </View>
      {pick.work_type ? (
        <View style={sheetContentStyles.row}>
          <Text style={sheetContentStyles.label}>Тип работ</Text>
          <Text style={sheetContentStyles.value}>{pick.work_type}</Text>
        </View>
      ) : null}
      {room ? (
        <Pressable
          style={sheetContentStyles.row}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Открыть комнату ${room.name}`}
          onPress={() => { onClose(); pushRoomDetail(room.id, pathname); }}
        >
          <Text style={sheetContentStyles.label}>Комната</Text>
          <Text style={sheetContentStyles.link}>{room.name} →</Text>
        </Pressable>
      ) : null}
      {stage ? (
        <Pressable
          style={sheetContentStyles.row}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Открыть этап ${stage.name}`}
          onPress={() => { onClose(); pushStageDetail(stage.id, pathname); }}
        >
          <Text style={sheetContentStyles.label}>Этап</Text>
          <Text style={sheetContentStyles.link}>{stage.name} →</Text>
        </Pressable>
      ) : null}
      {pick.shop_url ? (
        <Pressable
          style={sheetContentStyles.row}
          disabled={busy}
          accessibilityRole="link"
          accessibilityLabel={`Открыть магазин ${pick.shop_name || pick.name}`}
          onPress={() => { void openShop(); }}
        >
          <Text style={sheetContentStyles.label}>Магазин</Text>
          <Text style={sheetContentStyles.link}>{pick.shop_name || 'Открыть ссылку'} →</Text>
        </Pressable>
      ) : null}
      {pick.status === 'approved' ? (
        <Text style={sheetContentStyles.note}>Согласовано — в факт бюджета позиция попадёт после покупки.</Text>
      ) : null}
      {pick.status === 'purchased' ? (
        <Text style={[sheetContentStyles.note, { color: RenovaTheme.colors.warningText }]}>
          Учтено в факте. «Убрать из факта» изменит статус связанной закупки.
        </Text>
      ) : null}
      {pick.status === 'pending' && isCustomer ? (
        <Text style={sheetContentStyles.note}>После согласования подрядчик сможет закупить материал.</Text>
      ) : null}
    </SheetSurface>
  );
}
