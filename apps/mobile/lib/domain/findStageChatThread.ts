/** Подбор чата для этапа: topic stage/room, название, общий чат */
import type { ChatThread } from '@/lib/api/types/chat';
import type { Room, Stage } from '@/lib/api';

export function findStageChatThread(
  chats: ChatThread[],
  stage: Pick<Stage, 'id' | 'name' | 'room_ids'>,
  rooms: Pick<Room, 'id' | 'room_type'>[],
): ChatThread | null {
  if (!chats.length) return null;

  const byStageTopic = chats.find((c) => c.topic === `stage:${stage.id}`);
  if (byStageTopic) return byStageTopic;

  const roomTypes = new Set(
    (stage.room_ids || [])
      .map((rid) => rooms.find((r) => r.id === rid)?.room_type)
      .filter(Boolean),
  );
  for (const rt of roomTypes) {
    const roomChat = chats.find((c) => c.topic === `room:${rt}`);
    if (roomChat) return roomChat;
  }

  const normStage = stage.name.trim().toLowerCase();
  const byTitle = chats.find((c) => {
    const t = c.title.toLowerCase();
    if (t.includes(normStage)) return true;
    return normStage.split(/\s+/).some((w) => w.length > 3 && t.includes(w));
  });
  if (byTitle) return byTitle;

  return chats.find((c) => c.topic === 'general') ?? chats[0] ?? null;
}
