/** Node smoke: drop offline jobs for archived/trashed project. */
import assert from 'node:assert/strict';

function jobPathMatchesProject(path, projectId) {
  if (!projectId) return false;
  return path.includes(`/projects/${projectId}`);
}

function filterJobsExceptProject(jobs, projectId) {
  return jobs.filter((j) => !jobPathMatchesProject(j.path, projectId));
}

const pid = 'abc-123';
const jobs = [
  { id: '1', path: `/api/v1/projects/${pid}/receipts/manual`, method: 'POST' },
  { id: '2', path: '/api/v1/projects/other-id/payments', method: 'POST' },
  { id: '3', path: `/api/v1/projects/${pid}/stages/s1/submit`, method: 'POST' },
];

const left = filterJobsExceptProject(jobs, pid);
assert.equal(left.length, 1);
assert.equal(left[0].id, '2');
assert.equal(filterJobsExceptProject(jobs, '').length, 3);

console.log('OK projectQueueFilter (lifecycle drop)');
