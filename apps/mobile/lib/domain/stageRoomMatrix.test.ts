import { filterRoomsByArchive, filterStageRoomMatrix, toggleStageRoomLink } from './stageRoomMatrix';

const rooms = [
  { id: 'r1', name: 'Кухня' },
  { id: 'r2', name: 'Ванная' },
  { id: 'r3', name: 'Спальня' },
] as any[];

const stages = [
  { id: 's1', name: 'Плитка', room_ids: ['r1', 'r2'] },
  { id: 's2', name: 'Покраска', room_ids: [] },
  { id: 's3', name: 'Электрика', room_ids: ['r3'] },
] as any[];

const filtered = filterStageRoomMatrix(rooms, stages);
if (filtered.stages.length !== 2) throw new Error('expected 2 linked stages');
if (filtered.rooms.length !== 3) throw new Error('expected 3 linked rooms');
if (filtered.stages.some((s) => s.id === 's2')) throw new Error('empty room_ids stage must be hidden');

const toggledOff = toggleStageRoomLink(stages[0], 'r1');
if (toggledOff.length !== 1 || toggledOff[0] !== 'r2') throw new Error('toggle off failed');
const toggledOn = toggleStageRoomLink({ ...stages[0], room_ids: ['r2'] }, 'r1');
if (toggledOn.length !== 2) throw new Error('toggle on failed');

const archived = filterRoomsByArchive(
  [{ id: 'a', is_archived: true }, { id: 'b', is_archived: false }] as any[],
  false,
);
if (archived.length !== 1 || archived[0].id !== 'b') throw new Error('archive filter failed');

console.log('stageRoomMatrix.test OK');
