import assert from 'node:assert/strict';
import { pickPrimaryDemoProject } from './pickPrimaryDemoProject';
import { resolveActiveProjectId, isJunkProjectName } from './resolveActiveProjectId';

const projects = [
  { id: 'wizard', name: 'Wizard Test' },
  { id: 'apt', name: 'Демо-квартира, ул. Пример 12' },
  { id: 'b', name: 'Other' },
];

assert.equal(pickPrimaryDemoProject(projects)?.id, 'apt');
assert.equal(resolveActiveProjectId(projects, null), 'apt');
assert.equal(resolveActiveProjectId(projects, 'wizard'), 'apt');
assert.equal(isJunkProjectName('Wizard Test'), true);
assert.equal(isJunkProjectName('E2E Gate Test'), true);
assert.equal(isJunkProjectName('Студия'), true);
assert.equal(isJunkProjectName('Studio'), true);
assert.equal(isJunkProjectName('Моя студия'), false);
assert.equal(isJunkProjectName('Демо-квартира, ул. Пример 12'), false);

const withE2e = [
  { id: 'e2e', name: 'E2E Gate Test' },
  { id: 'apt', name: 'Демо-квартира, ул. Пример 12' },
];
assert.equal(pickPrimaryDemoProject(withE2e)?.id, 'apt');
assert.equal(resolveActiveProjectId(withE2e, 'e2e'), 'apt');

console.log('pickPrimaryDemoProject.test OK');
