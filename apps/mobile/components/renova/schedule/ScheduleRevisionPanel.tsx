/**
 * STG-007: изменение подтверждённого графика.
 * Исполнитель/прораб запрашивает ревизию (черновик), отправляет её заказчику;
 * заказчик подтверждает или отклоняет — тем же способом, что и сам график.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { api, type WorkSchedule } from '@/lib/api';
import { confirmAction, notifyError } from '@/lib/notify';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { reportError } from '@/lib/reportError';
import type { OsRole } from '@/constants/osSections';
import { diffRevisionItems, findOpenRevision, scheduleRevisionActions } from '@/lib/domain/scheduleRevision';

type Props = {
  role: OsRole;
  userId: string;
  projectId: string;
  /** Действующий подтверждённый график. */
  active: WorkSchedule;
  canManage: boolean;
  readOnly?: boolean;
  /** Что-то изменилось на сервере — родитель перечитывает график и побочные данные. */
  onChanged: () => void | Promise<void>;
};

const CHANGE_LABEL = { added: 'добавлено', removed: 'убрано', moved: 'сдвинуто' } as const;

export function ScheduleRevisionPanel({ role, userId, projectId, active, canManage, readOnly, onChanged }: Props) {
  const [all, setAll] = useState<WorkSchedule[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<'request' | 'submit' | 'confirm' | 'reject' | null>(null);
  const customerOrContractor = role === 'customer' ? 'customer' : 'contractor';

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setAll(await api.listWorkSchedules(userId, projectId));
    } catch (error) {
      reportError('schedule.revision.load', error, { projectId });
      setLoadFailed(true);
    }
  }, [userId, projectId]);

  useEffect(() => { void load(); }, [load, active.id, active.updated_at]);

  const revision = useMemo(() => findOpenRevision(active, all), [active, all]);
  const actions = scheduleRevisionActions({ role: customerOrContractor, canManage, readOnly, active, revision });
  const changes = useMemo(
    () => (revision && role === 'customer' ? diffRevisionItems(active.items ?? [], revision.items ?? []) : []),
    [active.items, revision, role],
  );

  if (active.status !== 'confirmed') return null;
  if (loadFailed) {
    return <LoadErrorState title="Не удалось проверить изменения графика" onRetry={() => void load()} role={role} />;
  }
  if (!all) return null;
  if (!actions.message && !actions.canRequest) return null;

  const run = async (kind: NonNullable<typeof busy>, label: string, call: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await call();
      await load();
      await onChanged();
    } catch (error) {
      if (isOfflineQueued(error)) notifyOfflineQueued(label, role);
      else {
        reportError(`schedule.revision.${kind}`, error, { projectId });
        notifyError(`${label}: не получилось`, error, 'Обновите экран и повторите.');
      }
    } finally {
      setBusy(null);
    }
  };

  const request = async () => {
    const yes = await confirmAction({
      title: 'Запросить изменение графика?',
      message: `${actions.message ?? ''} Прежний график продолжит действовать, пока заказчик не подтвердит новый.`.trim(),
      confirmLabel: 'Запросить',
    });
    if (yes) await run('request', 'Запрос изменения графика', () => api.requestWorkScheduleRevision(userId, projectId, active.id));
  };

  const submit = async () => {
    if (!revision) return;
    const yes = await confirmAction({
      title: 'Отправить изменение заказчику?',
      message: 'Заказчик получит уведомление и решит, подтвердить ли новый график.',
      confirmLabel: 'Отправить',
    });
    if (yes) await run('submit', 'Отправка изменения графика', () => api.submitWorkSchedule(userId, projectId, revision.id));
  };

  const confirm = async () => {
    if (!revision) return;
    const yes = await confirmAction({
      title: 'Подтвердить изменение графика?',
      message: 'Новые сроки заменят действующий график, даты этапов обновятся.',
      confirmLabel: 'Подтвердить',
    });
    if (yes) await run('confirm', 'Подтверждение графика', () => api.confirmWorkSchedule(userId, projectId, revision.id));
  };

  const reject = async () => {
    if (!revision) return;
    const yes = await confirmAction({
      title: 'Отклонить изменение графика?',
      message: 'Продолжит действовать прежний график, исполнитель получит уведомление.',
      confirmLabel: 'Отклонить',
      destructive: true,
    });
    if (yes) await run('reject', 'Отклонение изменения', () => api.rejectWorkSchedule(userId, projectId, revision.id, 'Нужна правка изменений графика'));
  };

  return (
    <View style={s.box} accessibilityLabel="Изменение подтверждённого графика">
      <Text style={s.head}>
        {revision ? `Изменение графика · версия ${revision.schedule_version ?? ''}`.trim() : 'Изменение подтверждённого графика'}
      </Text>
      {actions.message ? <Text style={s.text}>{actions.message}</Text> : null}
      {changes.length > 0 ? (
        <View style={s.changes}>
          {changes.map((change) => (
            <Text key={`${change.kind}:${change.title}`} style={s.text}>
              • {change.title} — {CHANGE_LABEL[change.kind]}{change.to ? `: ${change.to}` : ''}{change.from && change.kind !== 'added' ? ` (было ${change.from})` : ''}
            </Text>
          ))}
        </View>
      ) : null}
      {actions.canRequest ? (
        <PrimaryButton title="Запросить изменение графика" variant="outline" onPress={() => { void request(); }} loading={busy === 'request'} disabled={busy !== null} fullWidth />
      ) : null}
      {actions.canSubmit ? (
        <PrimaryButton title="Отправить заказчику" variant="accent" onPress={() => { void submit(); }} loading={busy === 'submit'} disabled={busy !== null} fullWidth />
      ) : null}
      {actions.canConfirm ? (
        <PrimaryButton title="Подтвердить" variant="accent" onPress={() => { void confirm(); }} loading={busy === 'confirm'} disabled={busy !== null} fullWidth />
      ) : null}
      {actions.canReject ? (
        <PrimaryButton title="Отклонить" variant="outline" onPress={() => { void reject(); }} loading={busy === 'reject'} disabled={busy !== null} fullWidth />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginTop: 10, padding: 10, borderRadius: RenovaTheme.radius.sm, backgroundColor: RenovaTheme.colors.infoBg, borderWidth: 1, borderColor: RenovaTheme.colors.infoBorder, gap: 8 },
  head: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.infoText },
  text: { fontSize: 12, color: RenovaTheme.colors.infoText, lineHeight: 17 },
  changes: { gap: 2 },
});
