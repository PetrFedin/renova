/** STG-002: заказчик решает по запросу исполнителя продлить срок доработки. */
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api, type StageDetail } from '@/lib/api';
import { confirmAction, notifyError } from '@/lib/notify';
import { reportError } from '@/lib/reportError';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import {
  extensionExceedsLimit,
  pendingReworkExtension,
  reworkExtensionView,
  REWORK_SLA_MAX_AHEAD_DAYS,
} from '@/lib/domain/reworkExtension';

function ruDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

type Props = {
  stage: StageDetail;
  isContractor: boolean;
  canWrite: boolean;
  userId: string;
  projectId: string;
  onChanged: () => Promise<void>;
};

export function ReworkExtensionRequestCard({ stage, isContractor, canWrite, userId, projectId, onChanged }: Props) {
  const [busy, setBusy] = useState<'extend' | 'decline' | null>(null);
  const request = pendingReworkExtension(stage, stage.comments);
  const view = reworkExtensionView({ isContractor, canWrite, request });
  if (!request || !view) return null;

  if (view === 'contractor_waiting') {
    return (
      <View style={s.box} accessibilityLabel="Запрос продления срока доработки">
        <Text style={s.head}>Запрос продления отправлен</Text>
        <Text style={s.text}>Вы просили срок до {ruDate(request.requestedDeadline)}. Срок изменится, когда заказчик подтвердит продление.</Text>
      </View>
    );
  }

  const overLimit = extensionExceedsLimit(stage.rework_deadline, request.days, new Date());

  const refresh = async () => {
    await onChanged();
    await syncProjectSideEffects({ user: { id: userId } as any, project: { id: projectId } as any, role: 'customer' });
  };

  const extend = async () => {
    const yes = await confirmAction({
      title: 'Продлить срок доработки?',
      message: `Срок доработки по этапу «${stage.name}» станет позже на ${request.days} дн. (запрошено до ${ruDate(request.requestedDeadline)}). Исполнитель получит уведомление.`,
      confirmLabel: 'Продлить',
    });
    if (!yes) return;
    setBusy('extend');
    try {
      await api.extendReworkSla(userId, projectId, stage.id, request.days);
      await refresh();
    } catch (error) {
      reportError('stage.reworkExtension.extend', error, { stageId: stage.id });
      notifyError('Срок не продлён', error, 'Обновите экран и повторите.');
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    const yes = await confirmAction({
      title: 'Отклонить продление?',
      message: 'Срок доработки останется прежним, исполнитель получит ответ.',
      confirmLabel: 'Отклонить',
      destructive: true,
    });
    if (!yes) return;
    setBusy('decline');
    try {
      await api.declineReworkSlaExtension(userId, projectId, stage.id);
      await refresh();
    } catch (error) {
      reportError('stage.reworkExtension.decline', error, { stageId: stage.id });
      notifyError('Не удалось отклонить', error, 'Обновите экран и повторите.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={s.box} accessibilityLabel="Запрос продления срока доработки">
      <Text style={s.head}>Исполнитель просит продлить срок до {ruDate(request.requestedDeadline)}</Text>
      <Text style={s.text}>
        {stage.rework_deadline ? `Сейчас срок доработки — ${ruDate(stage.rework_deadline)}. ` : ''}
        Решение за вами: срок не меняется, пока вы не ответите.
      </Text>
      {overLimit ? (
        <Text style={s.text}>Продлить нельзя: срок доработки не может быть дальше {REWORK_SLA_MAX_AHEAD_DAYS} дней от сегодня. Можно только отклонить запрос.</Text>
      ) : null}
      <View style={s.actions}>
        <PrimaryButton
          title="Продлить"
          variant="accent"
          onPress={() => { void extend(); }}
          loading={busy === 'extend'}
          disabled={overLimit || (busy !== null && busy !== 'extend')}
          fullWidth
        />
        <PrimaryButton
          title="Отклонить"
          variant="outline"
          onPress={() => { void decline(); }}
          loading={busy === 'decline'}
          disabled={busy !== null && busy !== 'decline'}
          fullWidth
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginTop: 8, padding: 10, borderRadius: RenovaTheme.radius.sm, backgroundColor: RenovaTheme.colors.infoBg, borderWidth: 1, borderColor: RenovaTheme.colors.infoBorder, gap: 6 },
  head: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.infoText },
  text: { fontSize: 12, color: RenovaTheme.colors.infoText, lineHeight: 17 },
  actions: { gap: 8, marginTop: 4 },
});
