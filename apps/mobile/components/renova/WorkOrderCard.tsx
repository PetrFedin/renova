/** Карточка детальной работы в календаре / списке */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { WORK_STATUS_LABEL, type WorkOrderStatus } from '@/lib/domain/workLifecycle';
import type { WorkOrder, Room } from '@/lib/api';
import { formatScheduleWorkSpan } from '@/lib/formatScheduleDate';
import { pushOsNav } from '@/lib/pushOsNav';
import { useRenova } from '@/lib/context/RenovaContext';
import type { OsRole } from '@/constants/osSections';
import { ConstructionLocationLine } from '@/components/renova/ConstructionLocationLine';

export function WorkOrderCard({ wo, rooms, compact }: { wo: WorkOrder; rooms?: Room[]; compact?: boolean }) {
  const pathname = usePathname();
  const { user, activeProject } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const status = (wo.status in WORK_STATUS_LABEL ? wo.status : 'draft') as WorkOrderStatus;
  const dates = formatScheduleWorkSpan(wo.planned_start, wo.planned_end);
  const locationRooms = rooms ?? activeProject?.rooms;

  return (
    <Pressable
      style={[s.row, compact && s.compact]}
      onPress={() =>
        pushOsNav({ pathname: '/work-order/[id]', params: { id: wo.id } }, pathname, role)
      }
      accessibilityRole="button"
      accessibilityLabel={`Работа: ${wo.title}`}
    >
      <View style={s.content}>
        <Text style={s.title} numberOfLines={1}>{wo.title}</Text>
        <Text style={s.meta} numberOfLines={1}>
          {WORK_STATUS_LABEL[status]}
          {dates ? ` · ${dates}` : ''}
          {wo.budget_planned ? ` · ${formatRub(wo.budget_planned)}` : ''}
        </Text>
        <ConstructionLocationLine
          roomId={wo.room_id}
          stageId={wo.stage_id}
          rooms={locationRooms}
          stages={activeProject?.stages}
          compact={compact}
        />
      </View>
      {wo.chat_thread_id && !compact ? (
        <Pressable
          style={s.chatButton}
          accessibilityRole="button"
          accessibilityLabel="Открыть чат по работе"
          onPress={(event) => {
            event.stopPropagation();
            pushOsNav(
              { pathname: '/chat/[threadId]', params: { threadId: wo.chat_thread_id! } },
              pathname,
              role,
            );
          }}
        >
          <Text style={s.chat}>💬</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { ...card, flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingVertical: 12 },
  compact: { paddingVertical: 8 },
  content: { flex: 1, minWidth: 0 },
  title: { fontWeight: '700', fontSize: 14, color: RenovaTheme.colors.text },
  meta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 3 },
  chatButton: {
    minWidth: RenovaTheme.minTouch,
    minHeight: RenovaTheme.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  chat: { fontSize: 18 },
});
