/** Авто-привязка чека к этапу по комнате (stage.room_ids) */
import type { Stage } from '@/lib/api';

const PRIORITY = ['active', 'review', 'planned', 'done'];

export function resolveStageForRoom(stages: Stage[], roomId?: string | null, manualStageId?: string | null): string | null {
  if (manualStageId) return manualStageId;
  if (!roomId || !stages.length) return null;
  const sorted = [...stages].sort((a, b) => PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status));
  for (const st of sorted) {
    if (st.room_ids?.includes(roomId)) return st.id;
  }
  return null;
}
