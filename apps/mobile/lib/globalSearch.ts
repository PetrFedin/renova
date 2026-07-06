import { ProjectDetail } from '@/lib/api';

const STAGE_STATUS: Record<string, string> = {
  done: 'Сдан', review: 'На приёмке', active: 'В работе', planned: 'Запланирован',
};

export type SearchHit = { id: string; type: 'stage' | 'room' | 'chat'; title: string; sub: string; href: string };

export function searchProject(project: ProjectDetail, q: string, chatTitles: Record<string, string> = {}): SearchHit[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const hits: SearchHit[] = [];
  for (const st of project.stages) {
    if (st.name.toLowerCase().includes(s))
      hits.push({ id: st.id, type: 'stage', title: st.name, sub: STAGE_STATUS[st.status] || st.status, href: `/stage/${st.id}` });
  }
  for (const r of project.rooms || []) {
    if (r.name.toLowerCase().includes(s))
      hits.push({ id: r.id, type: 'room', title: r.name, sub: `${r.floor_sq_m} м²`, href: `/room/${r.id}` });
  }
  for (const [tid, title] of Object.entries(chatTitles)) {
    if (title.toLowerCase().includes(s))
      hits.push({ id: tid, type: 'chat', title, sub: 'Чат', href: `/chat/${tid}` });
  }
  return hits.slice(0, 12);
}
