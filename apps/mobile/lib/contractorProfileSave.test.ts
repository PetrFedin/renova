import { buildRequisitesPatch, canSaveProfile, validateProfileFields, PROFILE_LIMITS } from './contractorProfileSave';

if (canSaveProfile('loading') || canSaveProfile('error') || !canSaveProfile('ready')) throw new Error('canSave');
const base = { company_name: 'ИП Иванов', payment_requisites: 'СБП +7' };
if (Object.keys(buildRequisitesPatch(base, base)).length !== 0) throw new Error('без изменений — пустой patch');
const p1 = buildRequisitesPatch(base, { ...base, company_name: 'ООО Ромашка' });
if (p1.company_name !== 'ООО Ромашка' || 'payment_requisites' in p1) throw new Error('только изменённое поле');
const p2 = buildRequisitesPatch(base, { ...base, payment_requisites: '  ' });
if (p2.payment_requisites !== '') throw new Error('осознанная очистка → пустая строка (null бэкенд игнорирует)');
const full = { ...base, specialties: 'плитка', city: 'Казань', bio: '' };
const p3 = buildRequisitesPatch(full, { ...full, city: ' Москва ', bio: 'опыт 10 лет' });
if (p3.city !== 'Москва' || p3.bio !== 'опыт 10 лет' || 'specialties' in p3 || 'company_name' in p3) throw new Error('специализации/город/био: только изменённое');
if (Object.keys(validateProfileFields({ specialties: 'x'.repeat(512), city: 'y'.repeat(64), bio: 'z'.repeat(4000) })).length !== 0) throw new Error('лимиты включительно');
const e = validateProfileFields({ specialties: 'x'.repeat(513), city: 'y'.repeat(65), bio: 'z'.repeat(4001) });
if (!e.specialties || !e.city || !e.bio || PROFILE_LIMITS.bio !== 4000) throw new Error('превышение лимитов бэкенда отклоняется');
console.log('contractorProfileSave.test OK');
