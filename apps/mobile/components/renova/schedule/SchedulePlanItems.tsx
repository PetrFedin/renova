/**
 * Пункты согласованного план-графика — смена статуса в поле (W109 API → UI).
 * Одна primary CTA на пункт; offline → очередь.
 */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { api, type WorkSchedule, type WorkScheduleItem, type WorkScheduleItemStatus } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { assertCanSetScheduleItemStatus } from '@/lib/scheduleItemStatusGuard';
import {
  SCHEDULE_ITEM_ACTION_LABEL,
  SCHEDULE_ITEM_STATUS_LABEL,
  primaryScheduleItemAction,
} from '@/lib/domain/scheduleItemNextActions';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { reportError } from '@/lib/reportError';

type Props = {
  schedule: WorkSchedule;
  role: OsRole;
  userId: string;
  projectId: string;
  canManage: boolean;
  readOnly?: boolean;
  onChanged: (next: WorkSchedule) => void;
};

export function SchedulePlanItems({
  schedule,
  role,
  userId,
  projectId,
  canManage,
  readOnly,
  onChanged,
}: Props) {
  const items = schedule.items ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!items.length) return null;

  const who = role === 'customer' ? 'customer' : 'manage';
  // Показывать блок после согласования или когда есть пункты (draft тоже полезен исполнителю)
  const showActions = !readOnly && (role === 'customer' || canManage);

  const applyStatus = async (item: WorkScheduleItem, to: WorkScheduleItemStatus) => {
    const gate = assertCanSetScheduleItemStatus(role, to);
    if (!gate.ok) {
      Alert.alert('График', gate.message);
      return;
    }
    if (role === 'customer' && to === 'accepted') {
      // Честность: сервер требует WA; предупреждаем заранее
      Alert.alert(
        'Приёмка этапа',
        'Принятие из графика возможно только после приёмки с фото и чеклистом. Продолжить?',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Продолжить', onPress: () => void runUpdate(item, to) },
        ],
      );
      return;
    }
    await runUpdate(item, to);
  };

  const runUpdate = async (item: WorkScheduleItem, to: WorkScheduleItemStatus) => {
    setBusyId(item.id);
    try {
      await api.updateWorkScheduleItemStatus(userId, projectId, schedule.id, item.id, { status: to });
      const fresh = await api.getActiveWorkSchedule(userId, projectId);
      if (fresh) onChanged(fresh);
    } catch (e) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued(SCHEDULE_ITEM_ACTION_LABEL[to] || 'Статус этапа');
        // Оптимистично обновим локально до flush
        onChanged({
          ...schedule,
          items: items.map((it) => (it.id === item.id ? { ...it, status: to } : it)),
        });
      } else {
        reportError('schedule.planItem.status', e);
        Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось сменить статус');
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={s.wrap} accessibilityLabel="Пункты план-графика">
      <Text style={s.title}>Этапы плана</Text>
      <Text style={s.sub}>
        {schedule.status === 'confirmed'
          ? 'Меняйте статус по ходу работ — синхронизируется с календарём'
          : 'После согласования графика статусы этапов станут рабочими для поля'}
      </Text>
      {items
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => {
          const primary = showActions ? primaryScheduleItemAction(item.status, who) : null;
          // Customer only acts on submitted; manage only when confirmed/draft/rejected useful
          const allowPrimary =
            primary &&
            (who === 'customer'
              ? item.status === 'submitted'
              : schedule.status === 'confirmed' || schedule.status === 'draft');
          const busy = busyId === item.id;
          return (
            <View key={item.id} style={s.row}>
              <View style={s.meta}>
                <Text style={s.itemTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={s.badge}>{SCHEDULE_ITEM_STATUS_LABEL[item.status] || item.status}</Text>
              </View>
              {allowPrimary && primary ? (
                <Pressable
                  style={[s.cta, busy && s.ctaDisabled]}
                  disabled={busy}
                  onPress={() => void applyStatus(item, primary)}
                  accessibilityRole="button"
                  accessibilityLabel={SCHEDULE_ITEM_ACTION_LABEL[primary] || primary}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={s.ctaT}>{SCHEDULE_ITEM_ACTION_LABEL[primary] || primary}</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          );
        })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: 10,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.border,
  },
  title: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  sub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, marginBottom: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RenovaTheme.colors.border,
  },
  meta: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 14, fontWeight: '600', color: RenovaTheme.colors.text },
  badge: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.textMuted, marginTop: 2 },
  cta: {
    backgroundColor: RenovaTheme.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 96,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.6 },
  ctaT: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
