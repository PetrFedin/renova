/**
 * Единый граф строительного проекта.
 *
 * API хранит связи в отдельных полях room_id / stage_id / room_ids. Этот слой
 * нормализует их в двунаправленный граф, чтобы экраны не собирали собственные
 * несовместимые индексы и могли открывать все связанные сущности из одного
 * помещения или этапа.
 */
import type {
  ActivityItem,
  OsExpense,
  ProjectIssue,
  Room,
  Stage,
  WorkAcceptance,
  WorkOrder,
} from '@/lib/api';

export type ConstructionGraphNodeKind =
  | 'room'
  | 'stage'
  | 'work_order'
  | 'issue'
  | 'acceptance'
  | 'expense'
  | 'activity';

export type ConstructionGraphRelation =
  | 'contains'
  | 'located_in'
  | 'belongs_to_stage'
  | 'accepts_stage'
  | 'records_activity';

export type ConstructionGraphNode = {
  key: string;
  kind: ConstructionGraphNodeKind;
  id: string;
  title: string;
  roomIds: string[];
  stageIds: string[];
  relatedKeys: string[];
  unresolvedReferences: string[];
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
};

export type BuildConstructionProjectGraphInput = {
  rooms?: readonly Room[];
  stages?: readonly Stage[];
  workOrders?: readonly WorkOrder[];
  issues?: readonly ProjectIssue[];
  acceptances?: readonly WorkAcceptance[];
  expenses?: readonly OsExpense[];
  activities?: readonly ActivityItem[];
};

export function constructionGraphNodeKey(kind: ConstructionGraphNodeKind, id: string): string {
  return `${kind}:${id}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function buildConstructionProjectGraph(
  input: BuildConstructionProjectGraphInput,
): ConstructionProjectGraph {
  const nodes: Record<string, ConstructionGraphNode> = {};
  const edges: ConstructionGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const byRoom: Record<string, string[]> = {};
  const byStage: Record<string, string[]> = {};

  const addNode = (
    kind: ConstructionGraphNodeKind,
    id: string,
    title: string,
    roomIds: readonly (string | null | undefined)[] = [],
    stageIds: readonly (string | null | undefined)[] = [],
  ) => {
    const key = constructionGraphNodeKey(kind, id);
    nodes[key] = {
      key,
      kind,
      id,
      title: title.trim() || id,
      roomIds: unique(roomIds.filter((value): value is string => Boolean(value))),
      stageIds: unique(stageIds.filter((value): value is string => Boolean(value))),
      relatedKeys: [],
      unresolvedReferences: [],
    };
    return nodes[key];
  };

  for (const room of input.rooms ?? []) {
    addNode('room', room.id, room.name, [room.id]);
  }
  for (const stage of input.stages ?? []) {
    addNode('stage', stage.id, stage.name, stage.room_ids ?? [], [stage.id]);
  }
  for (const workOrder of input.workOrders ?? []) {
    addNode('work_order', workOrder.id, workOrder.title, [workOrder.room_id], [workOrder.stage_id]);
  }
  for (const issue of input.issues ?? []) {
    addNode('issue', issue.id, issue.title, [issue.room_id], [issue.stage_id]);
  }
  for (const acceptance of input.acceptances ?? []) {
    addNode(
      'acceptance',
      acceptance.id,
      acceptance.stage_name?.trim() || `Приёмка этапа ${acceptance.stage_id}`,
      [],
      [acceptance.stage_id],
    );
  }
  for (const expense of input.expenses ?? []) {
    addNode('expense', expense.id, expense.title, [expense.room_id], [expense.stage_id]);
  }
  for (const activity of input.activities ?? []) {
    addNode('activity', activity.id, activity.title, [activity.room_id]);
  }

  const addIndex = (index: Record<string, string[]>, id: string, nodeKey: string) => {
    index[id] = unique([...(index[id] ?? []), nodeKey]);
  };

  const connect = (
    sourceKey: string,
    targetKey: string,
    relation: ConstructionGraphRelation,
  ) => {
    if (!nodes[sourceKey] || !nodes[targetKey]) return;
    const edgeKey = `${sourceKey}>${relation}>${targetKey}`;
    if (!edgeKeys.has(edgeKey)) {
      edgeKeys.add(edgeKey);
      edges.push({ source: sourceKey, target: targetKey, relation });
    }
    nodes[sourceKey].relatedKeys = unique([...nodes[sourceKey].relatedKeys, targetKey]);
    nodes[targetKey].relatedKeys = unique([...nodes[targetKey].relatedKeys, sourceKey]);
  };

  for (const node of Object.values(nodes)) {
    for (const roomId of node.roomIds) {
      addIndex(byRoom, roomId, node.key);
      const roomKey = constructionGraphNodeKey('room', roomId);
      if (nodes[roomKey]) {
        if (node.kind !== 'room') {
          connect(node.key, roomKey, node.kind === 'stage' ? 'contains' : 'located_in');
        }
      } else if (node.kind !== 'room') {
        node.unresolvedReferences.push(`room:${roomId}`);
      }
    }

    for (const stageId of node.stageIds) {
      addIndex(byStage, stageId, node.key);
      const stageKey = constructionGraphNodeKey('stage', stageId);
      if (nodes[stageKey]) {
        if (node.kind === 'acceptance') {
          connect(node.key, stageKey, 'accepts_stage');
        } else if (node.kind === 'activity') {
          connect(node.key, stageKey, 'records_activity');
        } else if (node.kind !== 'stage') {
          connect(node.key, stageKey, 'belongs_to_stage');
        }
      } else if (node.kind !== 'stage') {
        node.unresolvedReferences.push(`stage:${stageId}`);
      }
    }

    node.unresolvedReferences = unique(node.unresolvedReferences);
  }

  return { nodes, edges, byRoom, byStage };
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
