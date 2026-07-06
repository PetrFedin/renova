import { buildQuickWizardRooms, quickWizardFloorSqM } from './buildQuickWizardRooms';

const apt = buildQuickWizardRooms('apartment', 45);
if (apt.length !== 5) throw new Error('apartment rooms');
if (quickWizardFloorSqM(apt) < 40 || quickWizardFloorSqM(apt) > 55) throw new Error('apartment area scale');

const house = buildQuickWizardRooms('house', 120);
if (house.length !== 7) throw new Error('house rooms');
if (quickWizardFloorSqM(house) < 100) throw new Error('house area');

console.log('buildQuickWizardRooms.test OK');
