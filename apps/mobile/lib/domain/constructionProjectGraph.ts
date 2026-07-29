/**
 * Нормализованный граф строительного проекта.
 *
 * `undefined` source означает «не загружено», пустой массив — «загружено, данных нет».
 * Поэтому ссылки на незагруженный источник остаются pending, а ссылки на отсутствующего
 * родителя в загруженном источнике считаются missing/invalid.
 */

export type ConstructionGraphNodeKind =
  | 'project'
  | 'room'
  | 'stage'
  | 'work_order'
  | 'material'
  | 'expense'
  | 'payment'
  | 'document'
  | 'issue'
  | 'acceptance'
  | 'activity';

export type ConstructionGraphRelation =
  | 'belongs_to_project'
  | 'contains'
  | 'located_in'
  | 'belongs_to_stage'
  | 'accepts_stage'
  | 'records_activity'
  | 'documents';

export type ConstructionGraphSource =
  | 'rooms'
  | 'stages'
  | 'workOrders'
  | 'materials'
  | 'expenses'
  | 'payments'
  | 'documents'
  | 'issues'
  | 'acceptances'
  | 'activities';

export type ConstructionGraphSourceState = 'not_loaded' | 'loaded';

type ProjectScoped = { project_id?: string | null };
type RoomStageScoped = ProjectScoped & { room_id?: string | null; stage_id?: string | null };

type GraphRoom = ProjectScoped & { id: string; name: string };
type GraphStage = ProjectScoped & { id: string; name: string; room_ids?: string[] };
type GraphWorkOrder = RoomStageScoped & { id: string; title: string };
type GraphMaterial = RoomStageScoped & { id: string; name: string };
type GraphExpense = RoomStageScoped & { id: string; title: string };
type GraphPayment = RoomStageScoped & { id: string; title: string };
type GraphIssue = RoomStageScoped & { id: string; title: string };
type GraphAcceptance = RoomStageScoped & { id: string; stage_name?: string | null };
type GraphActivity = RoomStageScoped & { id: string; title: string };

export type ConstructionGraphDocumentOwnerKind =
  | 'project'
  | 'room'
  | 'stage'
  | 'work_order'
  | 'material'
  | 'expense'
  | 'payment';

export type ConstructionGraphDocument = RoomStageScoped & {
  id: string;
  title: string;
  owner_kind?: ConstructionGraphDocumentOwnerKind | string | null;
  owner_id?: string | null;
};

export type ConstructionGraphNode = {
  key: string;
  kind: ConstructionGraphNodeKind;
  id: string;
  title: string;
  projectId?: string;
  roomIds: string[];
  stageIds: string[];
  ownerKeys: string[];
  relatedKeys: string[];
  unresolvedReferences: string[];
  pendingReferences: string[];
};

export type ConstructionGraphEdge = {
  source: string;
  target: string;
  relation: ConstructionGraphRelation;
};

export type ConstructionProjectGraph = {
  nodes: Record<string, ConstructionGraphNode>;
  edges: ConstructionGraphEdge[];
  byRoom: Record<string, string[]>;
  byStage: Record<string, string[]>;
  duplicateKeys: string[];
  invalidReferences: Record<string, string[]>;
  sourceStates: Record<ConstructionGraphSource, ConstructionGraphSourceState>;
};

export type ConstructionGraphIntegrity = {
  nodeCount: number;
  edgeCount: number;
  duplicateKeys: string[];
  unresolvedByNode: Record<string, string[]>;
  pendingByNode: Record<string, string[]>;
  unresolvedCount: number;
  pendingCount: number;
  invalidReferences: Record<string, string[]>;
  notLoadedSources: ConstructionGraphSource[];
  isHealthy: boolean;
};

export type BuildConstructionProjectGraphInput = {
  projectId?: string;
  projectTitle?: string;
  rooms?: readonly GraphRoom[];
  stages?: readonly GraphStage[];
  workOrders?: readonly GraphWorkOrder[];
  materials?: readonly GraphMaterial[];
  expenses?: readonly GraphExpense[];
  payments?: readonly GraphPayment[];
  documents?: readonly ConstructionGraphDocument[];
  issues?: readonly GraphIssue[];
  acceptances?: readonly GraphAcceptance[];
  activities?: readonly GraphActivity[];
  sourceStates?: Partial<Record<ConstructionGraphSource, ConstructionGraphSourceState>>;
};

const SOURCE_KEYS: ConstructionGraphSource[] = [
  'rooms',
  'stages',
  'workOrders',
  'materials',
  'expenses',
  'payments',
  'documents',
  'issues',
  'acceptances',
  'activities',
];

const OWNER_KIND_TO_SOURCE: Partial<Record<ConstructionGraphNodeKind, ConstructionGraphSource>> = {
  room: 'rooms',
  stage: 'stages',
  work_order: 'workOrders',
  material: 'materials',
  expense: 'expenses',
  payment: 'payments',
};

export function constructionGraphNodeKey(kind: ConstructionGraphNodeKind, id: string): string {
  return `${kind}:${id}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sourceState(
  input: BuildConstructionProjectGraphInput,
  source: ConstructionGraphSource,
): ConstructionGraphSourceState {
  const explicit = input.sourceStates?.[source];
  if (explicit) return explicit;
  return input[source] === undefined ? 'not_loaded' : 'loaded';
}

function entityProjectId(entity: ProjectScoped, fallback?: string): string | undefined {
  return entity.project_id || fallback || undefined;
}

export function buildConstructionProjectGraph(
  input: BuildConstructionProjectGraphInput,
): ConstructionProjectGraph {
  const nodes: Record<string, ConstructionGraphNode> = {};
  const edges: ConstructionGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const duplicateKeys = new Set<string>();
  const invalidReferences: Record<string, string[]> = {};
  const byRoom: Record<string, string[]> = {};
  const byStage: Record<string, string[]> = {};
  const sourceStates = Object.fromEntries(
    SOURCE_KEYS.map((source) => [source, sourceState(input, source)]),
  ) as Record<ConstructionGraphSource, ConstructionGraphSourceState>;

  const addInvalid = (nodeKey: string, issue: string) => {
    invalidReferences[nodeKey] = unique([...(invalidReferences[nodeKey] ?? []), issue]);
  };

  const addNode = (
    kind: ConstructionGraphNodeKind,
    id: string,
    title: string,
    roomIds: readonly (string | null | undefined)[] = [],
    stageIds: readonly (string | null | undefined)[] = [],
    projectId?: string,
    ownerKeys: readonly string[] = [],
  ) => {
    const key = constructionGraphNodeKey(kind, id);
    if (nodes[key]) duplicateKeys.add(key);
    nodes[key] = {
      key,
      kind,
      id,
      title: title.trim() || id,
      ...(projectId ? { projectId } : {}),
      roomIds: unique(roomIds.filter((value): value is string => Boolean(value))),
      stageIds: unique(stageIds.filter((value): value is string => Boolean(value))),
      ownerKeys: unique(ownerKeys),
      relatedKeys: [],
      unresolvedReferences: [],
      pendingReferences: [],
    };
    if (kind !== 'project' && !projectId) addInvalid(key, 'missing_project');
    if (input.projectId && projectId && projectId !== input.projectId) {
      addInvalid(key, `cross_project:project:${input.projectId}`);
    }
    return nodes[key];
  };

  if (input.projectId) {
    addNode('project', input.projectId, input.projectTitle || 'Проект', [], [], input.projectId);
  }

  for (const room of input.rooms ?? []) {
    addNode('room', room.id, room.name, [room.id], [], entityProjectId(room, input.projectId));
  }
  for (const stage of input.stages ?? []) {
    addNode('stage', stage.id, stage.name, stage.room_ids ?? [], [stage.id], entityProjectId(stage, input.projectId));
  }
  for (const work of input.workOrders ?? []) {
    addNode('work_order', work.id, work.title, [work.room_id], [work.stage_id], entityProjectId(work, input.projectId));
  }
  for (const material of input.materials ?? []) {
    addNode('material', material.id, material.name, [material.room_id], [material.stage_id], entityProjectId(material, input.projectId));
  }
  for (const expense of input.expenses ?? []) {
    addNode('expense', expense.id, expense.title, [expense.room_id], [expense.stage_id], entityProjectId(expense, input.projectId));
  }
  for (const payment of input.payments ?? []) {
    addNode('payment', payment.id, payment.title, [payment.room_id], [payment.stage_id], entityProjectId(payment, input.projectId));
  }
  for (const issue of input.issues ?? []) {
    addNode('issue', issue.id, issue.title, [issue.room_id], [issue.stage_id], entityProjectId(issue, input.projectId));
  }
  for (const acceptance of input.acceptances ?? []) {
    addNode(
      'acceptance',
      acceptance.id,
      acceptance.stage_name?.trim() || `Приёмка этапа ${acceptance.stage_id || ''}`,
      [acceptance.room_id],
      [acceptance.stage_id],
      entityProjectId(acceptance, input.projectId),
    );
  }
  for (const activity of input.activities ?? []) {
    addNode('activity', activity.id, activity.title, [activity.room_id], [activity.stage_id], entityProjectId(activity, input.projectId));
  }
  for (const document of input.documents ?? []) {
    const projectId = entityProjectId(document, input.projectId);
    const ownerKeys: string[] = [];
    if (document.owner_kind && document.owner_id) {
      const ownerKind = document.owner_kind as ConstructionGraphNodeKind;
      const allowed = new Set<ConstructionGraphNodeKind>(['project', 'room', 'stage', 'work_order', 'material', 'expense', 'payment']);
      if (allowed.has(ownerKind)) ownerKeys.push(constructionGraphNodeKey(ownerKind, document.owner_id));
    } else if (document.owner_kind || document.owner_id) {
      ownerKeys.push('invalid:partial_owner');
    } else if (projectId) {
      ownerKeys.push(constructionGraphNodeKey('project', projectId));
    }
    const node = addNode(
      'document',
      document.id,
      document.title,
      [document.room_id],
      [document.stage_id],
      projectId,
      ownerKeys,
    );
    if (!node.ownerKeys.length) addInvalid(node.key, 'missing_owner');
    if (node.ownerKeys.includes('invalid:partial_owner')) addInvalid(node.key, 'partial_owner');
    if (document.owner_kind && document.owner_id && !ownerKeys.length) {
      addInvalid(node.key, `invalid_owner_kind:${document.owner_kind}`);
    }
  }

  const addIndex = (index: Record<string, string[]>, id: string, nodeKey: string) => {
    index[id] = unique([...(index[id] ?? []), nodeKey]);
  };

  const connect = (sourceKey: string, targetKey: string, relation: ConstructionGraphRelation) => {
    const source = nodes[sourceKey];
    const target = nodes[targetKey];
    if (!source || !target) return;
    if (source.projectId && target.projectId && source.projectId !== target.projectId) {
      addInvalid(sourceKey, `cross_project:${targetKey}`);
      return;
    }
    const edgeKey = `${sourceKey}>${relation}>${targetKey}`;
    if (!edgeKeys.has(edgeKey)) {
      edgeKeys.add(edgeKey);
      edges.push({ source: sourceKey, target: targetKey, relation });
    }
    source.relatedKeys = unique([...source.relatedKeys, targetKey]);
    target.relatedKeys = unique([...target.relatedKeys, sourceKey]);
  };

  const recordMissing = (
    node: ConstructionGraphNode,
    source: ConstructionGraphSource,
    reference: string,
  ) => {
    if (sourceStates[source] === 'not_loaded') {
      node.pendingReferences = unique([...node.pendingReferences, reference]);
    } else {
      node.unresolvedReferences = unique([...node.unresolvedReferences, reference]);
    }
  };

  const projectKey = input.projectId ? constructionGraphNodeKey('project', input.projectId) : null;

  for (const node of Object.values(nodes)) {
    if (projectKey && node.kind !== 'project' && node.projectId === input.projectId) {
      connect(node.key, projectKey, 'belongs_to_project');
    }

    for (const roomId of node.roomIds) {
      addIndex(byRoom, roomId, node.key);
      const roomKey = constructionGraphNodeKey('room', roomId);
      if (nodes[roomKey]) {
        if (node.kind !== 'room') connect(node.key, roomKey, node.kind === 'stage' ? 'contains' : 'located_in');
      } else if (node.kind !== 'room') {
        recordMissing(node, 'rooms', roomKey);
      }
    }

    for (const stageId of node.stageIds) {
      addIndex(byStage, stageId, node.key);
      const stageKey = constructionGraphNodeKey('stage', stageId);
      if (nodes[stageKey]) {
        if (node.kind === 'acceptance') connect(node.key, stageKey, 'accepts_stage');
        else if (node.kind === 'activity') connect(node.key, stageKey, 'records_activity');
        else if (node.kind !== 'stage') connect(node.key, stageKey, 'belongs_to_stage');
      } else if (node.kind !== 'stage') {
        recordMissing(node, 'stages', stageKey);
      }
    }

    if (node.kind === 'document') {
      for (const ownerKey of node.ownerKeys) {
        if (ownerKey.startsWith('invalid:')) continue;
        const [ownerKind] = ownerKey.split(':') as [ConstructionGraphNodeKind];
        if (nodes[ownerKey]) {
          connect(node.key, ownerKey, 'documents');
          continue;
        }
        const ownerSource = OWNER_KIND_TO_SOURCE[ownerKind];
        if (ownerKind === 'project') {
          node.unresolvedReferences = unique([...node.unresolvedReferences, ownerKey]);
        } else if (ownerSource) {
          recordMissing(node, ownerSource, ownerKey);
        } else {
          node.unresolvedReferences = unique([...node.unresolvedReferences, ownerKey]);
        }
      }
    }
  }

  return {
    nodes,
    edges,
    byRoom,
    byStage,
    duplicateKeys: [...duplicateKeys].sort(),
    invalidReferences,
    sourceStates,
  };
}

export function inspectConstructionProjectGraph(
  graph: ConstructionProjectGraph,
): ConstructionGraphIntegrity {
  const unresolvedByNode: Record<string, string[]> = {};
  const pendingByNode: Record<string, string[]> = {};
  let unresolvedCount = 0;
  let pendingCount = 0;

  for (const node of Object.values(graph.nodes)) {
    if (node.unresolvedReferences.length) {
      unresolvedByNode[node.key] = [...node.unresolvedReferences];
      unresolvedCount += node.unresolvedReferences.length;
    }
    if (node.pendingReferences.length) {
      pendingByNode[node.key] = [...node.pendingReferences];
      pendingCount += node.pendingReferences.length;
    }
  }

  return {
    nodeCount: Object.keys(graph.nodes).length,
    edgeCount: graph.edges.length,
    duplicateKeys: [...graph.duplicateKeys],
    unresolvedByNode,
    pendingByNode,
    unresolvedCount,
    pendingCount,
    invalidReferences: graph.invalidReferences,
    notLoadedSources: SOURCE_KEYS.filter((source) => graph.sourceStates[source] === 'not_loaded'),
    isHealthy: unresolvedCount === 0
      && graph.duplicateKeys.length === 0
      && Object.keys(graph.invalidReferences).length === 0,
  };
}

export function getConstructionGraphNode(
  graph: ConstructionProjectGraph,
  kind: ConstructionGraphNodeKind,
  id: string,
): ConstructionGraphNode | undefined {
  return graph.nodes[constructionGraphNodeKey(kind, id)];
}

export function getRelatedConstructionNodes(
  graph: ConstructionProjectGraph,
  kind: ConstructionGraphNodeKind,
  id: string,
  allowedKinds?: readonly ConstructionGraphNodeKind[],
): ConstructionGraphNode[] {
  const node = getConstructionGraphNode(graph, kind, id);
  if (!node) return [];
  const allowed = allowedKinds ? new Set(allowedKinds) : null;
  return node.relatedKeys
    .map((key) => graph.nodes[key])
    .filter((related): related is ConstructionGraphNode => Boolean(related))
    .filter((related) => !allowed || allowed.has(related.kind));
}

export function getConstructionContextNodes(
  graph: ConstructionProjectGraph,
  context: {
    roomId?: string | null;
    stageId?: string | null;
    allowedKinds?: readonly ConstructionGraphNodeKind[];
  },
): ConstructionGraphNode[] {
  const keys = unique([
    ...(context.roomId ? graph.byRoom[context.roomId] ?? [] : []),
    ...(context.stageId ? graph.byStage[context.stageId] ?? [] : []),
  ]);
  const allowed = context.allowedKinds ? new Set(context.allowedKinds) : null;
  return keys
    .map((key) => graph.nodes[key])
    .filter((node): node is ConstructionGraphNode => Boolean(node))
    .filter((node) => !allowed || allowed.has(node.kind));
}
