import { getDetailLevel, DetailLevel } from '@/lib/detailLevel';
import { getSectionDetail, SectionKey } from '@/lib/sectionDetail';

/** Глобальный default + override секции */
export async function resolveDetail(section?: SectionKey): Promise<DetailLevel> {
  const global = await getDetailLevel();
  if (!section) return global;
  const local = await getSectionDetail(section);
  if (local !== 'standard') return local;
  return global;
}
