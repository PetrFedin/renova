export type TechnologyStage =
  | 'survey'
  | 'design'
  | 'demolition'
  | 'rough-electrical'
  | 'rough-plumbing'
  | 'surface-preparation'
  | 'plastering'
  | 'waterproofing'
  | 'flooring'
  | 'tiling'
  | 'painting'
  | 'finish-electrical'
  | 'finish-plumbing'
  | 'cleanup';

export interface TechnologyTask {
  id: TechnologyStage;
  name: string;
  dependsOn: readonly TechnologyStage[];
  applicableTo: readonly ('cosmetic' | 'bathroom' | 'kitchen' | 'capital')[];
}

export interface TechnologyPlan {
  orderedTasks: readonly TechnologyTask[];
  stages: readonly TechnologyStage[];
}

/**
 * Базовый технологический граф ремонта.
 * Он описывает порядок выполнения, а не календарные длительности.
 * Длительности и ресурсы будут накладываться следующим CPM-слоем.
 */
export const TECHNOLOGY_GRAPH: Readonly<Record<TechnologyStage, TechnologyTask>> = Object.freeze({
  survey: {
    id: 'survey',
    name: 'Обмер и обследование',
    dependsOn: [],
    applicableTo: ['cosmetic', 'bathroom', 'kitchen', 'capital'],
  },
  design: {
    id: 'design',
    name: 'Проектирование и спецификация',
    dependsOn: ['survey'],
    applicableTo: ['cosmetic', 'bathroom', 'kitchen', 'capital'],
  },
  demolition: {
    id: 'demolition',
    name: 'Демонтаж',
    dependsOn: ['design'],
    applicableTo: ['bathroom', 'kitchen', 'capital'],
  },
  'rough-electrical': {
    id: 'rough-electrical',
    name: 'Черновая электрика',
    dependsOn: ['demolition'],
    applicableTo: ['bathroom', 'kitchen', 'capital'],
  },
  'rough-plumbing': {
    id: 'rough-plumbing',
    name: 'Черновая сантехника',
    dependsOn: ['demolition'],
    applicableTo: ['bathroom', 'kitchen', 'capital'],
  },
  'surface-preparation': {
    id: 'surface-preparation',
    name: 'Подготовка оснований',
    dependsOn: ['design'],
    applicableTo: ['cosmetic', 'bathroom', 'kitchen', 'capital'],
  },
  plastering: {
    id: 'plastering',
    name: 'Штукатурные работы',
    dependsOn: ['surface-preparation', 'rough-electrical', 'rough-plumbing'],
    applicableTo: ['bathroom', 'kitchen', 'capital'],
  },
  waterproofing: {
    id: 'waterproofing',
    name: 'Гидроизоляция',
    dependsOn: ['plastering'],
    applicableTo: ['bathroom'],
  },
  flooring: {
    id: 'flooring',
    name: 'Монтаж напольного покрытия',
    dependsOn: ['surface-preparation'],
    applicableTo: ['cosmetic', 'kitchen', 'capital'],
  },
  tiling: {
    id: 'tiling',
    name: 'Плиточные работы',
    dependsOn: ['waterproofing', 'plastering'],
    applicableTo: ['bathroom', 'kitchen'],
  },
  painting: {
    id: 'painting',
    name: 'Окраска стен',
    dependsOn: ['surface-preparation', 'plastering'],
    applicableTo: ['cosmetic', 'capital'],
  },
  'finish-electrical': {
    id: 'finish-electrical',
    name: 'Чистовая электрика',
    dependsOn: ['painting', 'tiling'],
    applicableTo: ['bathroom', 'kitchen', 'capital'],
  },
  'finish-plumbing': {
    id: 'finish-plumbing',
    name: 'Чистовая сантехника',
    dependsOn: ['tiling'],
    applicableTo: ['bathroom', 'kitchen', 'capital'],
  },
  cleanup: {
    id: 'cleanup',
    name: 'Финишная уборка и приёмка',
    dependsOn: ['flooring', 'painting', 'tiling', 'finish-electrical', 'finish-plumbing'],
    applicableTo: ['cosmetic', 'bathroom', 'kitchen', 'capital'],
  },
});

export function buildTechnologyPlan(
  renovationType: 'cosmetic' | 'bathroom' | 'kitchen' | 'capital',
): TechnologyPlan {
  validateTechnologyGraph(TECHNOLOGY_GRAPH);

  const applicable = new Set<TechnologyStage>(
    Object.values(TECHNOLOGY_GRAPH)
      .filter((task) => task.applicableTo.includes(renovationType))
      .map((task) => task.id),
  );

  const ordered = topologicalSort(applicable);

  return {
    orderedTasks: ordered.map((stage) => TECHNOLOGY_GRAPH[stage]),
    stages: ordered,
  };
}

export function validateTechnologyGraph(
  graph: Readonly<Record<TechnologyStage, TechnologyTask>>,
): void {
  const stages = new Set<TechnologyStage>(Object.keys(graph) as TechnologyStage[]);

  for (const task of Object.values(graph)) {
    if (task.id !== graph[task.id]?.id) {
      throw new Error(`Technology task key mismatch: ${task.id}`);
    }
    if (!task.name.trim()) {
      throw new Error(`Technology task ${task.id} must have a name`);
    }
    if (new Set(task.dependsOn).size !== task.dependsOn.length) {
      throw new Error(`Technology task ${task.id} has duplicate dependencies`);
    }
    for (const dependency of task.dependsOn) {
      if (!stages.has(dependency)) {
        throw new Error(`Technology task ${task.id} references unknown dependency ${dependency}`);
      }
      if (dependency === task.id) {
        throw new Error(`Technology task ${task.id} cannot depend on itself`);
      }
    }
  }

  topologicalSort(stages, graph);
}

function topologicalSort(
  included: ReadonlySet<TechnologyStage>,
  graph: Readonly<Record<TechnologyStage, TechnologyTask>> = TECHNOLOGY_GRAPH,
): TechnologyStage[] {
  const permanent = new Set<TechnologyStage>();
  const temporary = new Set<TechnologyStage>();
  const result: TechnologyStage[] = [];

  const visit = (stage: TechnologyStage): void => {
    if (permanent.has(stage)) return;
    if (temporary.has(stage)) {
      throw new Error(`Technology graph contains a cycle at ${stage}`);
    }

    temporary.add(stage);
    for (const dependency of graph[stage].dependsOn) {
      if (included.has(dependency)) visit(dependency);
    }
    temporary.delete(stage);
    permanent.add(stage);
    result.push(stage);
  };

  for (const stage of included) visit(stage);
  return result;
}
