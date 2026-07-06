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

console.log('pickPrimaryDemoProject.test OK');
