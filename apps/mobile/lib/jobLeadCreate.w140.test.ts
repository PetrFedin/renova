/** W140: заявка заказчика — форма, не демо-хардкод */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const board = readFileSync(join(mobile, 'components/renova/JobLeadsBoard.tsx'), 'utf8');
const sheetPath = join(mobile, 'components/renova/CreateJobLeadSheet.tsx');

function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

must(existsSync(sheetPath), 'CreateJobLeadSheet missing');
const sheet = readFileSync(sheetPath, 'utf8');

must(board.includes('CreateJobLeadSheet'), 'board opens CreateJobLeadSheet');
must(board.includes('setCreateOpen(true)'), 'button opens form');
must(!board.includes("title: 'Ремонт квартиры'"), 'no hardcoded title');
must(!board.includes('area_sqm: 55'), 'no hardcoded 55 m²');
must(!board.includes('budget_hint: 800000'), 'no hardcoded 800k');
must(sheet.includes('Новая заявка') && sheet.includes('area_sqm'), 'sheet collects area');
must(sheet.includes('budget_hint') && sheet.includes('renovation_type'), 'sheet collects budget+type');
must(sheet.includes('Укажите площадь') && sheet.includes('Укажите ориентировочный бюджет'), 'validation');

console.log('jobLeadCreate.w140.test.ts OK');
