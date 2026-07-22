/**
 * Единый пользовательский контекст строительной локации.
 *
 * Доменные сущности могут хранить ссылки раздельно (room_id, stage_id,
 * floor_plan_id и координаты), но UI должен показывать один стабильный путь:
 * этаж → помещение → этап → точка на плане.
 */
import type { Room, Stage } from '@/lib/api';

export type ConstructionLocationResolution = 'resolved' | 'partial' | 'unlocated';

export type ConstructionLocation = {
  label: string;
  parts: string[];
  floorLabel?: string;
  roomLabel?: string;
  stageLabel?: string;
  planLabel?: string;
  hasPlanPin: boolean;
  resolution: ConstructionLocationResolution;
};

type LocationRoom = Pick<Room, 'id' | 'name' | 'floor_level'>;
type LocationStage = Pick<Stage, 'id' | 'name'>;

export type ResolveConstructionLocationInput = {
  roomId?: string | null;
  stageId?: string | null;
  floorPlanId?: string | null;
  xPct?: number | null;
  yPct?: number | null;
  rooms?: readonly LocationRoom[];
  stages?: readonly LocationStage[];
};

function floorLabel(level: number | undefined): string | undefined {
  if (!Number.isFinite(level)) return undefined;
  if (level === 0) return 'Уровень 0';
  return `${level} этаж`;
}

function cleanName(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function resolveConstructionLocation(
  input: ResolveConstructionLocationInput,
): ConstructionLocation {
  const room = input.roomId ? input.rooms?.find((item) => item.id === input.roomId) : undefined;
  const stage = input.stageId ? input.stages?.find((item) => item.id === input.stageId) : undefined;

  const resolvedRoom = cleanName(room?.name);
  const resolvedStage = cleanName(stage?.name);
  const resolvedFloor = floorLabel(room?.floor_level);
  const hasPlanPin = Boolean(
    input.floorPlanId
      && Number.isFinite(input.xPct)
      && Number.isFinite(input.yPct),
  );
  const hasPlanReference = Boolean(input.floorPlanId);

  const parts = [
    resolvedFloor,
    resolvedRoom ?? (input.roomId ? 'Помещение привязано' : undefined),
    resolvedStage ?? (input.stageId ? 'Этап привязан' : undefined),
    hasPlanPin ? 'Точка на плане' : hasPlanReference ? 'План привязан' : undefined,
  ].filter((part): part is string => Boolean(part));

  const hasResolvedEntity = Boolean(resolvedRoom || resolvedStage || resolvedFloor || hasPlanPin);
  const hasAnyReference = Boolean(input.roomId || input.stageId || input.floorPlanId);
  const resolution: ConstructionLocationResolution = !hasAnyReference
    ? 'unlocated'
    : hasResolvedEntity
      ? 'resolved'
      : 'partial';

  return {
    label: parts.length ? parts.join(' · ') : 'Локация не указана',
    parts,
    floorLabel: resolvedFloor,
    roomLabel: resolvedRoom,
    stageLabel: resolvedStage,
    planLabel: hasPlanPin ? 'Точка на плане' : hasPlanReference ? 'План привязан' : undefined,
    hasPlanPin,
    resolution,
  };
}
