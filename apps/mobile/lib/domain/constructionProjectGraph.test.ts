import {
  buildConstructionProjectGraph,
  constructionGraphNodeKey,
  getConstructionContextNodes,
  getConstructionGraphNode,
  getRelatedConstructionNodes,
  inspectConstructionProjectGraph,
} from './constructionProjectGraph';

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const projectId = 'project-1';
const rooms = [{ id: 'room-kitchen', name: 'Кухня', project_id: projectId }];
const stages = [{ id: 'stage-electric', name: 'Электрика', project_id: projectId, room_ids: ['room-kitchen'] }];
const works = [{ id: 'work-cable', title: 'Проложить кабель', project_id: projectId, room_id: 'room-kitchen', stage_id: 'stage-electric' }];
const materials = [{ id: 'material-cable', name: 'Кабель ВВГнг', project_id: projectId, room_id: 'room-kitchen', stage_id: 'stage-electric' }];
const expenses = [{ id: 'expense-cable', title: 'Покупка кабеля', project_id: projectId, room_id: 'room-kitchen', stage_id: 'stage-electric' }];
const payments = [{ id: 'payment-cable', title: 'Оплата кабеля', project_id: projectId, stage_id: 'stage-electric' }];
const documents = [{ id: 'document-receipt', title: 'Чек на кабель', project_id: projectId, owner_kind: 'payment', owner_id: 'payment-cable' }];

{
  const graph = buildConstructionProjectGraph({
    projectId,
    rooms,
    stages,
    workOrders: works,
    materials,
    expenses,
    payments,
    documents,
    issues: [],
    acceptances: [],
    activities: [],
  });
  const integrity = inspectConstructionProjectGraph(graph);
  check(integrity.isHealthy, 'fully linked graph must be healthy');
  check(integrity.unresolvedCount === 0, 'fully linked graph has no missing parents');
  check(integrity.pendingCount === 0, 'fully loaded graph has no pending references');

  const stage = getConstructionGraphNode(graph, 'stage', 'stage-electric');
  check(Boolean(stage), 'stage node exists');
  check(stage!.relatedKeys.includes('work_order:work-cable'), 'stage links work');
  check(stage!.relatedKeys.includes('material:material-cable'), 'stage links material');
  check(stage!.relatedKeys.includes('expense:expense-cable'), 'stage links expense');
  check(stage!.relatedKeys.includes('payment:payment-cable'), 'stage links payment');

  const paymentDocs = getRelatedConstructionNodes(graph, 'payment', 'payment-cable', ['document']);
  check(paymentDocs.length === 1 && paymentDocs[0].id === 'document-receipt', 'payment links its document');

  const context = getConstructionContextNodes(graph, {
    roomId: 'room-kitchen',
    stageId: 'stage-electric',
    allowedKinds: ['work_order', 'material', 'expense', 'payment'],
  });
  check(context.length === 4, 'room and stage context is deduplicated');
}

{
  const graph = buildConstructionProjectGraph({
    projectId,
    rooms: [],
    stages: [],
    workOrders: [{ ...works[0], room_id: 'missing-room', stage_id: 'missing-stage' }],
  });
  const integrity = inspectConstructionProjectGraph(graph);
  check(!integrity.isHealthy, 'loaded missing parents are unhealthy');
  check(integrity.unresolvedCount === 2, 'room and stage orphans are explicit');
  check(integrity.unresolvedByNode['work_order:work-cable']?.includes('room:missing-room') ?? false, 'missing room');
  check(integrity.unresolvedByNode['work_order:work-cable']?.includes('stage:missing-stage') ?? false, 'missing stage');
}

{
  const graph = buildConstructionProjectGraph({
    projectId,
    workOrders: works,
  });
  const integrity = inspectConstructionProjectGraph(graph);
  check(integrity.isHealthy, 'unloaded parents are not treated as missing data');
  check(integrity.pendingCount === 2, 'unloaded room and stage references remain pending');
  check(integrity.notLoadedSources.includes('rooms') && integrity.notLoadedSources.includes('stages'), 'not loaded sources are reported');
}

{
  const graph = buildConstructionProjectGraph({
    projectId,
    rooms: [rooms[0], { ...rooms[0], name: 'Дубликат' }],
  });
  const integrity = inspectConstructionProjectGraph(graph);
  check(!integrity.isHealthy, 'duplicate ids are unhealthy');
  check(integrity.duplicateKeys[0] === constructionGraphNodeKey('room', 'room-kitchen'), 'duplicate key is explicit');
}

{
  const graph = buildConstructionProjectGraph({
    projectId,
    rooms,
    stages: [{ ...stages[0], project_id: 'project-2' }],
    workOrders: works,
  });
  const integrity = inspectConstructionProjectGraph(graph);
  check(!integrity.isHealthy, 'cross-project references are unhealthy');
  check(integrity.invalidReferences['stage:stage-electric']?.includes('cross_project:project:project-1') ?? false, 'foreign stage project is explicit');
  check(integrity.invalidReferences['work_order:work-cable']?.includes('cross_project:stage:stage-electric') ?? false, 'cross-project stage relation is explicit');
}

{
  const graph = buildConstructionProjectGraph({
    documents: [{ id: 'orphan-document', title: 'Файл без владельца' }],
    documents: [{ id: 'orphan-document', title: 'Файл без владельца' }],
  });
  const integrity = inspectConstructionProjectGraph(graph);
  check(!integrity.isHealthy, 'document without project or owner is unhealthy');
  check(integrity.invalidReferences['document:orphan-document']?.includes('missing_project') ?? false, 'document project is required');
  check(integrity.invalidReferences['document:orphan-document']?.includes('missing_owner') ?? false, 'document owner is required');
}

{
  const graph = buildConstructionProjectGraph({
    projectId,
    rooms: [],
    stages: [],
    workOrders: [],
    materials: [],
    expenses: [],
    payments: [],
    documents: [],
    issues: [],
    acceptances: [],
    activities: [],
  });
  const integrity = inspectConstructionProjectGraph(graph);
  check(integrity.isHealthy, 'loaded empty project is not an error');
  check(integrity.nodeCount === 1, 'empty project keeps only the project node');
}

console.log('constructionProjectGraph.test OK');
