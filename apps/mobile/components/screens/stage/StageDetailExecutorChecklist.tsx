/** Чек-лист исполнителя на активном этапе: без отметки пунктов этап не сдать (REP-01). */
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { api } from '@/lib/api';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { notifyError } from '@/lib/notify';
import { reportError } from '@/lib/reportError';

type WfCheck = { id: string; text: string; done: boolean };

type Props = {
  stageId: string;
  checks: WfCheck[];
  canWrite: boolean;
  userId: string;
  projectId: string;
  onChanged: () => Promise<void>;
};

export function StageDetailExecutorChecklist({ stageId, checks, canWrite, userId, projectId, onChanged }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!checks.length) return null;
  const doneCount = checks.filter((c) => c.done).length;

  const toggle = async (item: WfCheck) => {
    if (busyId || !canWrite) return;
    setBusyId(item.id);
    try {
      await api.toggleStageChecklist(userId, projectId, stageId, item.id, !item.done);
      await onChanged();
    } catch (error: unknown) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued('Отметка в чек-листе', 'contractor');
      } else {
        reportError('components.screens.stage.StageDetailExecutorChecklist.Toggle', error, { projectId, stageId });
        notifyError('Отметка не сохранена', error, 'Повторите попытку.');
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={s.wrap}>
      <Text style={s.head}>Чек-лист перед сдачей · {doneCount}/{checks.length}</Text>
      <Text style={s.hint}>Отметьте выполненные пункты — после этого этап можно сдать на приёмку.</Text>
      {checks.map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: c.done, disabled: !canWrite }}
          style={s.row}
          disabled={!canWrite || busyId !== null}
          onPress={() => { void toggle(c); }}
        >
          <Text style={s.text}>{c.done ? '☑' : '☐'} {c.text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: RenovaTheme.spacing.md, gap: 8 },
  head: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  hint: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  row: { ...card, padding: 10 },
  text: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.text },
});
