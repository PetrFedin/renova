import { offlineJobLabel, OFFLINE_JOB_FALLBACK_LABEL } from './offlineJobLabel';
import type { OfflineJob } from './offlineQueue';

const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };
const job = (method: string, path: string) => ({ method, path, body: '', userId: 'u' }) as unknown as OfflineJob;
const P = '/api/v1/projects/p1';
const label = (m: string, p: string) => offlineJobLabel(job(m, `${P}${p}`));

must(label('POST', '/stages/s1/submit') === 'Сдача этапа', 'stage submit');
must(label('POST', '/material-picks/m1/submit') === 'Согласование материала', 'material submit is not stage submit');
must(label('POST', '/design-packages/d1/submit') === 'Согласование дизайн-пакета', 'design submit');
must(label('POST', '/work-schedules/w1/submit') === 'Согласование графика', 'schedule submit');
must(label('POST', '/work-schedules/w1/confirm') === 'Согласование графика', 'schedule confirm is not payment');
must(label('POST', '/payments/x/confirm') === 'Подтверждение оплаты', 'payment confirm');
must(label('POST', '/work-acceptances/a/accept') === 'Решение по приёмке', 'acceptance accept');
must(label('POST', '/stages/s1/accept') === 'Приёмка этапа', 'stage accept');
must(label('POST', '/estimate/lines') === 'Строка сметы', 'estimate line');
must(label('POST', '/purchases/x/status') === 'Статус закупки', 'purchase status');
must(label('PATCH', '/rooms/r1') === 'Изменение комнаты', 'room patch');
must(label('POST', '/stages/s1/comments?x=1') === 'Комментарий этапа', 'query ignored');
must(label('GET', '/stages/s1/comments') === OFFLINE_JOB_FALLBACK_LABEL, 'method must match');
must(label('POST', '/something/unknown/submit') === OFFLINE_JOB_FALLBACK_LABEL, 'unknown path falls back');
must(offlineJobLabel(job('POST', '/api/v1/notifications/n1/read')) === 'Отметка уведомления', 'notification');
console.log('offlineJobLabel.test.ts ok');
