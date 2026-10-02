import assert from 'node:assert/strict';
import { decideRouteAudienceAccess, routeAudience } from './routeAudienceGuard';

const cust = { loading: false, hasUser: true, userRole: 'customer' };
const contr = { loading: false, hasUser: true, userRole: 'contractor' };

for (const p of ['/team-qr', '/checklist-templates', '/quality-control']) {
  assert.equal(routeAudience(p), 'contractor', p);
  assert.deepEqual(decideRouteAudienceAccess(p, contr), { kind: 'allow' }, `contractor ${p}`);
  assert.deepEqual(decideRouteAudienceAccess(p, { loading: true, hasUser: false }), { kind: 'wait' });
  const d = decideRouteAudienceAccess(p, cust);
  assert.equal(d.kind, 'redirect', `customer ${p}`);
}
// legit: заказчик из QC попадает в хаб приёмки, остальное — на главную
const qc = decideRouteAudienceAccess('/quality-control?issueId=1', cust);
assert.ok(qc.kind === 'redirect' && qc.to === 'repair-control');
const tq = decideRouteAudienceAccess('/team-qr', cust);
assert.ok(tq.kind === 'redirect' && tq.to === 'home' && tq.message.length > 10);
// общие экраны не затронуты
// портфель и очередь синхронизации — общие (пикер объектов и офлайн-баннер ведут туда обе роли)
for (const p of ['/portfolio', '/conflicts', '/guide', '/budget-planner', '/activity', '/work-acceptance', '/unknown']) {
  assert.deepEqual(decideRouteAudienceAccess(p, cust), { kind: 'allow' }, p);
}
// без сессии решает RoleGroupGuard/онбординг
assert.deepEqual(decideRouteAudienceAccess('/team-qr', { loading: false, hasUser: false }), { kind: 'allow' });
console.log('routeAudienceGuard.test OK');
