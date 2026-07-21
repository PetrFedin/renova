/** W78: недельный дайджест → insight на главной (без дубля API insights). */
import type { OsInsight } from '@/lib/api';

export type DigestPreviewHint = {
  title?: string;
  body?: string;
  weekly?: {
    warranty_open?: number | null;
    warranty_overdue?: number | null;
    pending_acceptances?: number | null;
    open_issues_count?: number | null;
  } | null;
};

/** CTA только если в неделе есть очередь (гарантия / приёмка / замечания). */
export function digestNeedsHomeCta(preview: DigestPreviewHint | null | undefined): boolean {
  if (!preview?.body) return false;
  const w = preview.weekly || {};
  return (
    Number(w.warranty_open || 0) > 0
    || Number(w.pending_acceptances || 0) > 0
    || Number(w.open_issues_count || 0) > 0
  );
}

export function buildDigestHomeInsight(preview: DigestPreviewHint): OsInsight | null {
  if (!digestNeedsHomeCta(preview)) return null;
  const w = preview.weekly || {};
  const bits: string[] = [];
  if (Number(w.pending_acceptances || 0) > 0) bits.push(`приёмка ${w.pending_acceptances}`);
  if (Number(w.warranty_open || 0) > 0) {
    bits.push(
      Number(w.warranty_overdue || 0) > 0
        ? `гарантия ${w.warranty_open} (просроч. ${w.warranty_overdue})`
        : `гарантия ${w.warranty_open}`,
    );
  }
  if (Number(w.open_issues_count || 0) > 0) bits.push(`замечания ${w.open_issues_count}`);
  return {
    id: 'weekly-digest',
    kind: 'digest',
    title: preview.title || 'Недельный дайджест',
    body: bits.length ? bits.join(' · ') : (preview.body || '').slice(0, 120),
    action: 'Отчёты',
    href: '/documents',
    priority: 70,
  };
}

/** Подмешать digest insight, не дублируя id. */
export function mergeDigestInsight(existing: OsInsight[], preview: DigestPreviewHint | null): OsInsight[] {
  const without = existing.filter((i) => i.id !== 'weekly-digest');
  if (!preview) return without;
  const row = buildDigestHomeInsight(preview);
  if (!row) return without;
  return [...without, row].sort((a, b) => (b.priority || 0) - (a.priority || 0));
}
