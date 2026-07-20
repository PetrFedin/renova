/**
 * W78 digest → home insight.
 * Run: npx tsx apps/mobile/lib/domain/digestHomeInsight.w78.test.ts
 */
import { buildDigestHomeInsight, digestNeedsHomeCta, mergeDigestInsight } from './digestHomeInsight';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(!digestNeedsHomeCta({ body: 'ok', weekly: {} }), 'no queue');
assert(digestNeedsHomeCta({ body: 'x', weekly: { pending_acceptances: 1 } }), 'accept');
assert(digestNeedsHomeCta({ body: 'x', weekly: { warranty_open: 2, warranty_overdue: 1 } }), 'warranty');

const insight = buildDigestHomeInsight({
  title: 'Недельный дайджест: Demo',
  body: 'long…',
  weekly: { pending_acceptances: 1, warranty_open: 2 },
});
assert(insight?.id === 'weekly-digest', 'id');
assert(/приёмка/.test(insight!.body), 'body accept');
assert(/гарантия/.test(insight!.body), 'body warranty');

const merged = mergeDigestInsight([{ id: 'a', kind: 'x', title: 'A', body: '', action: '', href: '/', priority: 10 }], {
  title: 'D',
  body: 'b',
  weekly: { open_issues_count: 3 },
});
assert(merged.some((i) => i.id === 'weekly-digest'), 'merged');

console.log('digestHomeInsight.w78.test OK');
