/** Панель детализации работы — заметки, связи, подсказки по процессу */
import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Pressable } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api, type WorkOrder } from '@/lib/api';
import {
  formatScheduleRange,
} from '@/lib/formatScheduleDate';
import { WORK_STATUS_LABEL, type WorkOrderStatus } from '@/lib/domain/workLifecycle';
import { calendarTabRoute, repairTabHref, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

type Props = {
  wo: WorkOrder;
  role: OsRole;
  roomName?: string;
  canWrite: boolean;
  userId: string;
  projectId: string;
  onUpdated: () => void;
};

const LINKS = [
  { id: 'chat', title: 'Обсуждение и уточнения', sub: 'Вопросы, согласования, фото в переписке' },
  { id: 'stage', title: 'Этап: фото и приёмка', sub: 'До / после, чеклист, комментарии' },
  { id: 'materials', title: 'Материалы', sub: 'Закупки и доп. позиции' },
  { id: 'approvals', title: 'Доп. работы и согласования', sub: 'То, чего не было в смете' },
] as const;

export function WorkOrderDetailPanel({
  wo,
  role,
  roomName,
  canWrite,
  userId,
  projectId,
  onUpdated,
}: Props) {
  const [notes, setNotes] = useState(wo.notes || '');
  const [saving, setSaving] = useState(false);
  const status = (wo.status in WORK_STATUS_LABEL ? wo.status : 'draft') as WorkOrderStatus;

  async function saveNotes() {
    setSaving(true);
    try {
      await api.patchWorkOrder(userId, projectId, wo.id, { notes: notes.trim() || null });
      onUpdated();
      Alert.alert('Сохранено', 'Описание работы обновлено');
    } catch {
      Alert.alert('Ошибка', 'Не удалось сохранить описание');
    } finally {
      setSaving(false);
    }
  }

  function openLink(id: string) {
    if (id === 'chat' && wo.chat_thread_id) {
      router.push({ pathname: '/chat/[threadId]', params: { threadId: wo.chat_thread_id, returnTo: `/work-order/${wo.id}` } } as any);
      return;
    }
    if (id === 'stage' && wo.stage_id) {
      router.push({ pathname: '/stage/[id]', params: { id: wo.stage_id, returnTo: `/work-order/${wo.id}` } } as any);
      return;
    }
    if (id === 'materials') {
      pushOsNav(repairTabHref(role, 'materials'), `/work-order/${wo.id}`);
      return;
    }
    if (id === 'approvals') {
      pushOsNav('/approvals', `/work-order/${wo.id}`);
    }
  }

  return (
    <View>
      <View style={s.card}>
        <Text style={s.blockTitle}>Сроки и статус</Text>
        <Text style={s.row}><Text style={s.label}>Статус </Text>{WORK_STATUS_LABEL[status]}</Text>
        <Text style={s.row}><Text style={s.label}>Комната </Text>{roomName || 'Общее'}</Text>
        <Text style={s.row}><Text style={s.label}>План </Text>{formatScheduleRange(wo.planned_start, wo.planned_end)}</Text>
        <Text style={s.row}>
          <Text style={s.label}>Факт </Text>
          {wo.actual_start || wo.actual_end
            ? formatScheduleRange(wo.actual_start, wo.actual_end)
            : 'ещё не начато'}
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.blockTitle}>Описание работы</Text>
        <Text style={s.hint}>
          {role === 'customer'
            ? 'Опишите пожелания, ограничения, что проверить. Исполнитель увидит здесь и в чате.'
            : 'Детали для заказчика: объём, нюансы, что нужно согласовать до старта.'}
        </Text>
        <TextInput
          style={s.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder="Например: заменить розетки, фото до начала, согласовать цвет..."
          multiline
          editable={canWrite}
        />
        {canWrite && (
          <PrimaryButton
            title={saving ? 'Сохранение…' : 'Сохранить описание'}
            variant="outline"
            disabled={saving || notes.trim() === (wo.notes || '').trim()}
            onPress={saveNotes}
          />
        )}
      </View>

      <Text style={s.section}>Связанные разделы</Text>
      {LINKS.map((link) => {
        const disabled =
          (link.id === 'chat' && !wo.chat_thread_id)
          || (link.id === 'stage' && !wo.stage_id);
        return (
          <Pressable
            key={link.id}
            style={[s.linkCard, disabled && s.linkDisabled]}
            disabled={disabled}
            onPress={() => openLink(link.id)}
          >
            <Text style={s.linkTitle}>{link.title}</Text>
            <Text style={s.linkSub}>
              {disabled
                ? (link.id === 'chat' ? 'Чат появится после публикации работы' : 'Этап не привязан')
                : link.sub}
            </Text>
          </Pressable>
        );
      })}

      <PrimaryButton title="Календарь" variant="outline" onPress={() => pushOsNav(calendarTabRoute(role), `/work-order/${wo.id}`)} />
    </View>
  );
}

const s = StyleSheet.create({
  card: { ...card, marginBottom: 12 },
  blockTitle: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginBottom: 8 },
  row: { fontSize: 14, marginBottom: 6, color: RenovaTheme.colors.text },
  label: { fontWeight: '700', color: RenovaTheme.colors.textMuted },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 17 },
  notesInput: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginBottom: 8,
    textAlignVertical: 'top',
  },
  section: { fontWeight: '700', marginVertical: 10, textTransform: 'uppercase', fontSize: 12, color: RenovaTheme.colors.textMuted },
  linkCard: { ...card, marginBottom: 8, paddingVertical: 12 },
  linkDisabled: { backgroundColor: '#f9fafb' },
  linkTitle: { fontWeight: '700', fontSize: 14 },
  linkSub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
});
