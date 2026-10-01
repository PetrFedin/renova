import { buildNewIssueBody, validateNewIssue } from './newIssueForm';

if (validateNewIssue('  ') === null || validateNewIssue('ab') === null) throw new Error('short title must be rejected');
if (validateNewIssue('Трещина') !== null) throw new Error('valid title rejected');
const full = buildNewIssueBody({ title: ' Трещина ', description: ' у окна ', severity: 'high', roomId: 'r1', stageId: 's1' });
if (full.title !== 'Трещина' || full.description !== 'у окна' || full.room_id !== 'r1' || full.stage_id !== 's1' || full.severity !== 'high') {
  throw new Error('full body');
}
const bare = buildNewIssueBody({ title: 'Течь', description: '  ', severity: 'medium', roomId: null, stageId: null });
if ('description' in bare || 'room_id' in bare || 'stage_id' in bare) throw new Error('empty optional fields must be omitted');
console.log('newIssueForm ok');
