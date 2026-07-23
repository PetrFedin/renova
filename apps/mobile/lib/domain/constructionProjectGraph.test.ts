import type { Room } from '@/lib/api/types/room';
import type { Stage } from '@/lib/api/types/stage';
import type { WorkOrder } from '@/lib/api/types/work';
import type { OsExpense, ProjectIssue } from '@/lib/api/types/os';
import {
  buildConstructionProjectGraph,
  constructionGraphNodeKey,
  getConstructionContextNodes,
  getConstructionGraphNode,
  getRelatedConstructionNodes,
  inspectConstructionProjectGraph,
  type ConstructionGraphAcceptance,
} from './constructionProjectGraph';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const rooms: Room[] = [
  {
    id: 'room-kitchen',
    name: 'Кухня',
    room_type: 'kitchen',
    floor_level: 2,
    length_m: 4,
    width_m: 3,
    height_m: 2.8,
    openings_sq_m: 2,
    outlets_count: 6,
    switches_count: 2,
    plumbing_points: 3,
    notes: null,
    floor_sq_m: 12,
    wall_sq_m: 37.2,
    perimeter_m: 14,
  },
  {
    id: 'room-hall',
    name: 'Коридор',
    room_type: 'hall',
    floor_level: 2,
    length_m: 5,
    width_m: 1.5,
    height_m: 2.8,
    openings_sq_m: 4,
    outlets_count: 2,
    switches_count: 2,
    plumbing_points: 0,
    notes: null,
    floor_sq_m: 7.5,
    wall_sq_m: 32.4,
    perimeter_m: 13,
  },
];

const stages: Stage[] = [
  {
    id: 'stage-electric',
    name: 'Электрика',
    sort_order: 1,
    status: 'active',
    percent_complete: 40,
    payment_amount: 120000,
    room_ids: ['room-kitchen'],
  },
];

const workOrders: WorkOrder[] = [
  {
    id: 'work-cable',
    project_id: 'project-1',
    room_id: 'room-kitchen',
    stage_id: 'stage-electric',
    work_type: 'electrical',
    title: 'Проложить кабельные линии',
    status: 'in_progress',
    budget_planned: 50000,
    budget_spent: 20000,
  },
];

const issues: ProjectIssue[] = [
  {
    id: 'issue-socket',
    title: 'Сместить розетку',
    severity: 'medium',
    status: 'open',
    stage_id: 'stage-electric',
  },
];

const acceptances: ConstructionGraphAcceptance[] = [
  {
    id: 'acceptance-electric',
    stage_id: 'stage-electric',
    room_id: 'room-kitchen',
    stage_name: 'Электрика',
    status: 'requested',
  },
];

const expenses: OsExpense[] = [
  {
    id: 'expense-cable',
    title: 'Кабель ВВГнг',
    category: 'materials',
    amount: 18000,
    status: 'paid',
    room_id: 'room-kitchen',
    stage_id: 'stage-electric',
  },
];

{
  const graph = buildConstructionProjectGraph({
    rooms,
    stages,
    workOrders,
    issues,
    acceptances,
    expenses,
  });

  const integrity = inspectConstructionProjectGraph(graph);
  assert(integrity.isHealthy, 'fully linked graph must be healthy');
  assert(integrity.nodeCount === 7, `expected 7 nodes, got ${integrity.nodeCount}`);
  assert(integrity.edgeCount === 8, `expected 8 edges, got ${integrity.edgeCount}`);

  const stage = getConstructionGraphNode(graph, 'stage', 'stage-electric');
  assert(Boolean(stage), 'stage node must exist');
  assert(stage!.relatedKeys.includes('room:room-kitchen'), 'stage must link to its room');
  assert(stage!.relatedKeys.includes('work_order:work-cable'), 'stage must link to work order');
  assert(stage!.relatedKeys.includes('issue:issue-socket'), 'stage must link to issue');
  assert(stage!.relatedKeys.includes('acceptance:acceptance-electric'), 'stage must link to acceptance');
  assert(stage!.relatedKeys.includes('expense:expense-cable'), 'stage must link to expense');

  const relatedOperational = getRelatedConstructionNodes(
    graph,
    'stage',
    'stage-electric',
    ['work_order', 'issue', 'acceptance', 'expense'],
  );
  assert(relatedOperational.length === 4, 'stage operational context must contain four linked records');

  const context = getConstructionContextNodes(graph, {
    roomId: 'room-kitchen',
    stageId: 'stage-electric',
    allowedKinds: ['work_order', 'issue', 'acceptance', 'expense'],
  });
  assert(context.length === 4, 'room + stage context must deduplicate shared records');
  assert(
    new Set(context.map((node) => node.key)).size === context.length,
    'context cannot return duplicate nodes',
  );
}

{
  const graph = buildConstructionProjectGraph({
    workOrders: [
      {
        ...workOrders[0],
        id: 'work-broken',
        room_id: 'missing-room',
        stage_id: 'missing-stage',
      },
    ],
  });
  const node = getConstructionGraphNode(graph, 'work_order', 'work-broken');
  const integrity = inspectConstructionProjectGraph(graph);

  assert(!integrity.isHealthy, 'broken references must make graph unhealthy');
  assert(integrity.unresolvedCount === 2, 'both room and stage references must be reported');
  assert(node?.unresolvedReferences.includes('room:missing-room') ?? false, 'missing room must be explicit');
  assert(node?.unresolvedReferences.includes('stage:missing-stage') ?? false, 'missing stage must be explicit');
}

{
  const graph = buildConstructionProjectGraph({ rooms: [rooms[0], { ...rooms[0], name: 'Дубликат кухни' }] });
  const integrity = inspectConstructionProjectGraph(graph);
  const key = constructionGraphNodeKey('room', 'room-kitchen');

  assert(!integrity.isHealthy, 'duplicate entity IDs must make graph unhealthy');
  assert(integrity.duplicateKeys.length === 1, 'one duplicate key expected');
  assert(integrity.duplicateKeys[0] === key, `unexpected duplicate key: ${integrity.duplicateKeys[0]}`);
}

console.log('constructionProjectGraph.test OK');
