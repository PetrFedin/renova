/**
 * W55: nextAction priority + role honesty (node: tsx / npx ts-node style assert).
 * Run: npx tsx apps/mobile/lib/domain/buildProjectOsSnapshot.w55.test.ts
 */
import { buildProjectOsSnapshot } from './buildProjectOsSnapshot';
import type { Dashboard, ProjectDetail } from '@/lib/api';

const baseDash = {
  next_action_title: '',
  next_action_type: '',
  progress_percent: 40,
  budget_variance_percent: 0,
} as Dashboard;

function project(partial: Partial<ProjectDetail> & { stages?: ProjectDetail['stages'] }): ProjectDetail {
  return {
    id: 'p1',
    name: 'Test',
    customer_id: 'c1',
    stages: partial.stages || [],
    rooms: [],
    estimate_lines: partial.estimate_lines || [],
    estimate_locked_at: partial.estimate_locked_at ?? null,
    budget_planned: 100000,
    budget_spent: 10000,
    ...partial,
  } as ProjectDetail;
}

// 1) Customer: schedule submitted beats materials
{
  const snap = buildProjectOsSnapshot(
    project({
      stages: [{ id: 's1', name: 'Черновые', status: 'active', planned_end: '2099-01-01' } as any],
      estimate_lines: [{ id: 'e1' } as any],
      estimate_locked_at: '2026-01-01',
    }),
    baseDash,
    [],
    [{ id: 'm1', status: 'pending', name: 'Плитка' } as any],
    [],
    [],
    null,
    'customer',
    null,
    0,
    0,
    0,
    { status: 'submitted' },
  );
  if (!/график/i.test(snap.nextAction.title)) throw new Error(`expected schedule confirm, got ${snap.nextAction.title}`);
}

// 2) Customer: unlocked estimate (no schedule)
{
  const snap = buildProjectOsSnapshot(
    project({
      stages: [{ id: 's1', name: 'Черновые', status: 'active' } as any],
      estimate_lines: [{ id: 'e1' } as any, { id: 'e2' } as any],
      estimate_locked_at: null,
    }),
    baseDash,
    [],
    [],
    [],
    [],
    null,
    'customer',
    null,
    0,
    0,
    0,
    { status: 'draft' },
  );
  if (!/смет/i.test(snap.nextAction.title)) throw new Error(`expected estimate lock, got ${snap.nextAction.title}`);
  if (snap.nextAction.kind !== 'expense') throw new Error('estimate kind=expense');
}

// 3) Customer materials = согласовать, not закупить
{
  const snap = buildProjectOsSnapshot(
    project({
      stages: [{ id: 's1', name: 'Черновые', status: 'active' } as any],
      estimate_lines: [{ id: 'e1' } as any],
      estimate_locked_at: '2026-01-01',
    }),
    baseDash,
    [],
    [{ id: 'm1', status: 'pending', name: 'Плитка' } as any],
    [],
    [],
    null,
    'customer',
    null,
    0,
    0,
    0,
    { status: 'confirmed' },
  );
  if (!/согласовать/i.test(snap.nextAction.title)) throw new Error(`expected approve materials, got ${snap.nextAction.title}`);
}

// 4) Contractor waiting acceptance
{
  const snap = buildProjectOsSnapshot(
    project({
      stages: [{ id: 's1', name: 'Отделка', status: 'review' } as any],
      estimate_locked_at: '2026-01-01',
      estimate_lines: [{ id: 'e1' } as any],
    }),
    baseDash,
    [],
    [],
    [],
    [],
    null,
    'contractor',
    null,
    1,
    0,
    0,
    null,
  );
  if (!/ждём приёмку/i.test(snap.nextAction.title)) throw new Error(`expected wait accept, got ${snap.nextAction.title}`);
}

// 5) Honest unpaid: stage proxy alone must not inflate
{
  const snap = buildProjectOsSnapshot(
    project({
      stages: [{ id: 's1', name: 'Done', status: 'done', customer_accepted_at: null } as any],
      estimate_locked_at: '2026-01-01',
      estimate_lines: [{ id: 'e1' } as any],
    }),
    { ...baseDash, progress_percent: 100 },
    [],
    [],
    [],
    [],
    null,
    'customer',
    null,
    0,
    0, // no real payments
    0,
    null,
  );
  if (snap.pendingPayments !== 0) throw new Error('unpaid must ignore stage proxy');
  if (snap.nextAction.href !== '/documents') throw new Error('complete → documents');
}

// 6) Real pending payment wins
{
  const snap = buildProjectOsSnapshot(
    project({
      stages: [{ id: 's1', name: 'Отделка', status: 'active' } as any],
      estimate_locked_at: '2026-01-01',
      estimate_lines: [{ id: 'e1' } as any],
    }),
    baseDash,
    [],
    [],
    [],
    [],
    null,
    'customer',
    null,
    0,
    2,
    50000,
    null,
  );
  if (snap.nextAction.kind !== 'payment') throw new Error('payment hero');
  if (snap.pendingPayments !== 2) throw new Error('pending count');
}

console.log('buildProjectOsSnapshot.w55.test OK');
