/** Заказчик: «Исполнитель предлагает вести проект» — подтвердить или отклонить */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { notifyAlert } from '@/lib/notify';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { AssignmentRequest } from '@/lib/api/assignmentRequests';
import { apiErrorMessage } from '@/lib/formatPhone';
import { reportCatch } from '@/lib/reportError';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useRenova } from '@/lib/context/RenovaContext';

export function AssignmentRequestsCard({
  userId,
  projectId,
  onResolved,
}: {
  userId: string;
  projectId: string;
  onResolved?: () => void;
}) {
  const { user } = useRenova();
  const [items, setItems] = useState<AssignmentRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .listAssignmentRequests(userId, projectId)
      .then((r) => setItems(r.items.filter((i) => i.status === 'pending')))
      .catch(reportCatch('components.renova.AssignmentRequestsCard.1'));
  }, [userId, projectId]);
  useEffect(() => { reload(); }, [reload]);
  useProjectDataReload(reload);

  const decide = async (item: AssignmentRequest, accept: boolean) => {
    setBusyId(item.id);
    try {
      if (accept) {
        const res = await api.acceptAssignmentRequest(userId, projectId, item.id);
        await syncProjectSideEffects({ user, project: res.project });
      } else {
        await api.declineAssignmentRequest(userId, projectId, item.id);
      }
      reload();
      onResolved?.();
    } catch (e: unknown) {
      notifyAlert(
        accept ? 'Не удалось подтвердить' : 'Не удалось отклонить',
        apiErrorMessage(e, 'Проверьте подключение'),
      );
      reload();
    } finally {
      setBusyId(null);
    }
  };

  if (!items.length) return null;

  return (
    <View style={s.box}>
      {items.map((item) => (
        <View key={item.id} style={s.card}>
          <Text style={s.title}>Исполнитель предлагает вести проект</Text>
          <Text style={s.name}>{item.contractor_name || 'Исполнитель'}</Text>
          {item.message ? <Text style={s.meta}>{item.message}</Text> : null}
          <PrimaryButton
            title={busyId === item.id ? '…' : 'Подтвердить'}
            variant="accent"
            compact
            disabled={!!busyId}
            onPress={() => decide(item, true)}
          />
          <PrimaryButton
            title="Отклонить"
            variant="outline"
            compact
            disabled={!!busyId}
            onPress={() => decide(item, false)}
          />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 8 },
  card: {
    padding: 12,
    borderRadius: RenovaTheme.radius.md,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
    gap: 6,
  },
  title: { fontWeight: '700', fontSize: 15, color: RenovaTheme.colors.text },
  name: { fontSize: 14, color: RenovaTheme.colors.text },
  meta: { fontSize: 13, color: RenovaTheme.colors.textMuted },
});
