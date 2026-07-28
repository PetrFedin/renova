/** Investor P1: portal pay/accept honesty — gate + W138 sheet, не сырой confirm */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const portal = readFileSync(join(mobile, 'app/portal.tsx'), 'utf8');
const misc = readFileSync(join(mobile, 'lib/api/misc.ts'), 'utf8');

console.assert(portal.includes('PaymentDetailSheet'), 'portal mounts PaymentDetailSheet');
console.assert(portal.includes('needs_acceptance') || portal.includes('needsAcceptance'), 'portal checks needs_acceptance');
console.assert(portal.includes('PAYMENT_BLOCKED_ACCEPTANCE_MSG'), 'portal shows acceptance gate copy');
console.assert(portal.includes('К подтверждению'), 'requisites CTA opens confirm sheet');
console.assert(portal.includes('Demo-оплата') || portal.includes('Оплата: DEMO'), 'demo mode honesty copy');
console.assert(portal.includes('Продолжить demo'), 'demo card requires confirm');
console.assert(!/confirmPayment\s*\(/.test(portal), 'portal must not call confirmPayment (W138)');
console.assert(portal.includes('checklist_required') || portal.includes('checklist_incomplete'), 'accept maps checklist 409');
console.assert(misc.includes('needs_acceptance'), 'snapshot type includes needs_acceptance');
console.assert(misc.includes('stage_id'), 'snapshot payment type includes stage_id');

console.assert(portal.includes('kontur_available'), 'portal gates Kontur CTA');
console.assert(misc.includes('kontur_available'), 'snapshot type includes kontur_available');

console.log('portalPayHonesty.w144.test OK');
