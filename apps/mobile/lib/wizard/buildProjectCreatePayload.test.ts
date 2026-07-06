import { buildProjectCreatePayload } from './buildProjectCreatePayload';

const payload = buildProjectCreatePayload({
  name: '  Тест  ',
  address: 'ул. Пример',
  renovation_type: 'cosmetic',
  property_type: 'house',
  rooms: [],
});

if (payload.name !== 'Тест') throw new Error('name trim');
if (payload.rooms.length !== 1) throw new Error('default room');
if (payload.property_type !== 'house') throw new Error('property_type');
if (!payload.total_area_sqm) throw new Error('area');

const p2 = buildProjectCreatePayload({
  name: 'Квартира',
  rooms: [{ name: 'Кухня', room_type: 'kitchen', length_m: 4, width_m: 3, height_m: 2.7 }],
});
if (p2.rooms[0].room_type !== 'kitchen') throw new Error('room type');

console.log('buildProjectCreatePayload.test OK');
