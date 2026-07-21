/** W139: acceptance decide body — без fake 10/5 */
import { acceptanceDecisionBody } from './acceptanceDecide';

const empty = acceptanceDecisionBody();
if ('quality_score' in empty && empty.quality_score != null) {
  throw new Error('empty body must omit quality_score');
}

const noScore = acceptanceDecisionBody({ comment: 'Работы приняты' });
if (noScore.quality_score != null) throw new Error('comment-only must not invent score');
if (noScore.comment !== 'Работы приняты') throw new Error('comment passthrough');

const scored = acceptanceDecisionBody({ qualityScore: 8, comment: 'ok' });
if (scored.quality_score !== 8) throw new Error('explicit score must pass');

const returned = acceptanceDecisionBody({
  qualityScore: null,
  comment: 'Нужна доработка',
  createIssue: true,
});
if (returned.quality_score != null) throw new Error('null score must omit field');
if (!returned.create_issue) throw new Error('create_issue');

const outOfRange = acceptanceDecisionBody({ qualityScore: 99 });
if (outOfRange.quality_score != null) throw new Error('out of range must omit');

console.log('acceptanceDecide.w139.test.ts OK');
