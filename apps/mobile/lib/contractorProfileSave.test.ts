import { buildRequisitesPatch, canSaveProfile } from './contractorProfileSave';

if (canSaveProfile('loading') || canSaveProfile('error') || !canSaveProfile('ready')) throw new Error('canSave');
const base = { company_name: 'ИП Иванов', payment_requisites: 'СБП +7' };
if (Object.keys(buildRequisitesPatch(base, base)).length !== 0) throw new Error('без изменений — пустой patch');
const p1 = buildRequisitesPatch(base, { ...base, company_name: 'ООО Ромашка' });
if (p1.company_name !== 'ООО Ромашка' || 'payment_requisites' in p1) throw new Error('только изменённое поле');
const p2 = buildRequisitesPatch(base, { ...base, payment_requisites: '  ' });
if (p2.payment_requisites !== null) throw new Error('осознанная очистка → null');
console.log('contractorProfileSave.test OK');
