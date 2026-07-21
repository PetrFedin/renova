/** W140: заявка заказчика — форма, не демо-хардкод */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const repo = join(__dirname, '../../..');
const board = readFileSync(join(mobile, 'components/renova/JobLeadsBoard.tsx'), 'utf8');
const sheetPath = join(mobile, 'components/renova/CreateJobLeadSheet.tsx');
const market = readFileSync(join(mobile, 'lib/api/market.ts'), 'utf8');
const leadIn = readFileSync(join(repo, 'backend/app/api/v1/marketplace.py'), 'utf8');

function must(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

must(existsSync(sheetPath), 'CreateJobLeadSheet missing');
const sheet = readFileSync(sheetPath, 'utf8');

must(board.includes('CreateJobLeadSheet'), 'board opens CreateJobLeadSheet');
must(board.includes('setCreateOpen(true)'), 'button opens form');
must(board.includes('alertJobLeadCreated'), 'success alert');
must(board.includes('l.description'), 'list shows description');
must(!board.includes("title: 'Ремонт квартиры'"), 'no hardcoded title');
must(!board.includes('area_sqm: 55'), 'no hardcoded 55 m²');
must(!board.includes('budget_hint: 800000'), 'no hardcoded 800k');
must(sheet.includes('Новая заявка') && sheet.includes('area_sqm'), 'sheet collects area');
must(sheet.includes('budget_hint') && sheet.includes('renovation_type'), 'sheet collects budget+type');
must(sheet.includes('if (busy) return'), 'double-submit guard');
must(sheet.includes('Отмена') && sheet.includes('requestClose'), 'cancel while idle');
must(sheet.includes('canSubmit'), 'submit gated');
must(market.includes('export type JobLeadCreateBody'), 'shared API body type');
must(leadIn.includes('min_length=1') && leadIn.includes('Field(gt=0'), 'backend LeadIn required fields');
must(leadIn.includes('budget_hint: float = Field(gt=0'), 'backend budget required');

console.log('jobLeadCreate.w140.test.ts OK');
