import { resolveConstructionLocation } from './constructionLocation';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const rooms = [
  { id: 'room-kitchen', name: 'Кухня', floor_level: 2 },
  { id: 'room-basement', name: 'Техническое помещение', floor_level: -1 },
  { id: 'room-ground', name: 'Лобби', floor_level: 0 },
];

const stages = [
  { id: 'stage-electric', name: 'Электрика' },
  { id: 'stage-finish', name: 'Чистовая отделка' },
];

{
  const location = resolveConstructionLocation({
    roomId: 'room-kitchen',
    stageId: 'stage-electric',
    floorPlanId: 'plan-2',
    xPct: 48,
    yPct: 31,
    rooms,
    stages,
  });

  assert(location.resolution === 'resolved', 'fully linked location must resolve');
  assert(
    location.label === 'Этаж 2 · Кухня · Электрика · Точка на плане',
    `unexpected resolved label: ${location.label}`,
  );
  assert(location.hasPlanPin, 'complete plan coordinates must produce a pin');
  assert(location.unresolvedReferences.length === 0, 'resolved location cannot contain broken references');
}

{
  const location = resolveConstructionLocation({ stageId: 'stage-finish', stages });
  assert(location.resolution === 'resolved', 'stage-only context is a valid location scope');
  assert(location.label === 'Чистовая отделка', 'stage-only label');
}

{
  const basement = resolveConstructionLocation({ roomId: 'room-basement', rooms });
  assert(
    basement.label === 'Подземный уровень 1 · Техническое помещение',
    `basement label: ${basement.label}`,
  );

  const ground = resolveConstructionLocation({ roomId: 'room-ground', rooms });
  assert(ground.label === 'Уровень 0 · Лобби', `ground label: ${ground.label}`);
}

{
  const location = resolveConstructionLocation({
    roomId: 'missing-room',
    stageId: 'stage-electric',
    rooms,
    stages,
  });

  assert(location.resolution === 'partial', 'broken room reference must be partial');
  assert(location.unresolvedReferences.length === 1, 'one broken reference expected');
  assert(location.unresolvedReferences[0] === 'room', 'broken room reference must be identified');
  assert(
    location.label === 'Помещение привязано · Электрика',
    `partial location must preserve known context: ${location.label}`,
  );
}

{
  const location = resolveConstructionLocation({
    roomId: 'missing-room',
    stageId: 'missing-stage',
    rooms,
    stages,
  });

  assert(location.resolution === 'partial', 'all broken references are still partial, not unlocated');
  assert(location.unresolvedReferences.includes('room'), 'room break missing');
  assert(location.unresolvedReferences.includes('stage'), 'stage break missing');
}

{
  const location = resolveConstructionLocation({ floorPlanId: 'plan-1' });
  assert(location.resolution === 'resolved', 'plan reference without pin remains a valid location');
  assert(location.label === 'План привязан', 'plan-only label');
  assert(!location.hasPlanPin, 'incomplete coordinates must not create a pin');
}

{
  const location = resolveConstructionLocation({});
  assert(location.resolution === 'unlocated', 'empty context must be unlocated');
  assert(location.label === 'Локация не указана', 'empty location label');
  assert(location.parts.length === 0, 'empty location must have no parts');
}

console.log('constructionLocation.test OK');
