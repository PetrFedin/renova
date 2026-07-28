/**
 * Investor P2: DocumentsHub — deep-link «в раздел» по source/kind документа.
 * Зачем: Alert без маршрута оставлял пользователя в тупике; CTA ведёт в канон SoT.
 */
import type { ProjectDocument } from '@/lib/api';
import {
  budgetTabRoute,
  objectTabRoute,
  repairTabRoute,
  type OsRole,
  type OsTabRoute,
} from '@/constants/osSections';

export type DocumentSectionTarget = {
  /** Подпись кнопки в Alert */
  label: string;
  route: OsTabRoute | string;
};

/** Куда вести из карточки документа (не PDF open / не Contour). */
export function documentSectionTarget(role: OsRole, doc: ProjectDocument): DocumentSectionTarget {
  const kind = (doc.kind || '').toLowerCase();
  const source = (doc.source || '').toLowerCase();

  if (source === 'receipt' || kind.includes('receipt')) {
    return { label: 'К расходам', route: budgetTabRoute(role, 'expenses') };
  }
  if (source === 'acceptance' || kind.includes('acceptance') || kind.includes('act')) {
    const stageId = typeof doc.meta?.stage_id === 'string' ? doc.meta.stage_id : undefined;
    if (stageId) {
      return { label: 'К этапу', route: { pathname: '/stage/[id]', params: { id: stageId } } };
    }
    return { label: 'К приёмке', route: repairTabRoute(role, 'control') };
  }
  if (source === 'design' || kind.includes('design')) {
    return { label: 'К дизайну', route: objectTabRoute(role, 'plan', 'design') };
  }
  if (kind.includes('estimate') || kind.includes('smeta')) {
    return { label: 'К смете', route: objectTabRoute(role, 'estimate') };
  }
  if (kind.includes('warranty') || kind.includes('garant')) {
    return { label: 'К гарантии', route: '/control?focus=warranty' };
  }
  if (kind.includes('payment') || kind.includes('invoice')) {
    return { label: 'К оплатам', route: budgetTabRoute(role, 'payments') };
  }
  // fallback — план объекта (раньше «К объекту» всегда на plan)
  return { label: 'К объекту', route: objectTabRoute(role, 'plan', 'floor') };
}
