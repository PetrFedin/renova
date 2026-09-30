import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calcRoomMetrics, generateTemplateLines, quantityWithWaste, wallpaperRolls } from './index';

// EST-030: те же эталоны читает backend/tests/test_calc_reference_cases.py.
const reference = JSON.parse(
  readFileSync(join(__dirname, '../../../../packages/calc-engine/reference-cases.json'), 'utf8'),
) as {
  cases: Array<{
    name: string;
    room: { length_m: number; width_m: number; height_m: number; openings_sq_m: number };
    expected: Record<string, number>;
  }>;
};

function near(actual: number, expected: number, label: string) {
  if (Math.abs(actual - expected) > 0.005) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

for (const c of reference.cases) {
  const { room, expected } = c;
  const m = calcRoomMetrics({
    lengthM: room.length_m,
    widthM: room.width_m,
    heightM: room.height_m,
    openingsSqM: room.openings_sq_m,
  });
  near(m.floorSqM, expected.floor_sq_m, `${c.name} floor`);
  near(m.wallSqM, expected.wall_sq_m, `${c.name} wall`);
  near(m.perimeterM, expected.perimeter_m, `${c.name} perimeter`);

  const qty = (type: 'cosmetic' | 'capital' | 'bathroom', name: string) => {
    const line = generateTemplateLines(type, 'r', m).materials.find((l) => l.name === name);
    if (!line) throw new Error(`${c.name}: нет строки «${name}» в шаблоне ${type}`);
    return line.quantity;
  };
  near(qty('cosmetic', 'Краска интерьерная'), expected.paint_l, `${c.name} paint`);
  near(qty('cosmetic', 'Ламинат'), expected.laminate_sq_m, `${c.name} laminate`);
  near(qty('capital', 'Штукатурная смесь'), expected.plaster_kg, `${c.name} plaster`);
  near(qty('bathroom', 'Керамогранит'), expected.bathroom_tile_sq_m, `${c.name} bathroom tile`);
  near(quantityWithWaste(m.floorSqM, 'tile'), expected.floor_tile_sq_m, `${c.name} floor tile`);
  if (wallpaperRolls(m.wallSqM) !== expected.wallpaper_rolls) {
    throw new Error(`${c.name} wallpaper: expected ${expected.wallpaper_rolls}, got ${wallpaperRolls(m.wallSqM)}`);
  }
}

// потолочное округление: 47 м² стен × 1,15 = 54,05 м² → 11 рулонов по 5 м², а не 10
if (wallpaperRolls(47) !== 11) throw new Error('wallpaperRolls(47) must round up to 11');
if (wallpaperRolls(0) !== 0) throw new Error('no walls → no wallpaper');
let rejected = false;
try { wallpaperRolls(-1); } catch (e) { rejected = e instanceof RangeError; }
if (!rejected) throw new Error('negative wall area must be rejected');

console.log('calc-engine referenceCases.test OK');
