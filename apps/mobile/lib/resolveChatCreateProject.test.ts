import { resolveChatCreateProject } from './resolveChatCreateProject';

let ok = true;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL', msg); ok = false; }
}

const projects = [
  { id: 'p1', name: 'Квартира 1' },
  { id: 'p2', name: 'Квартира 2' },
];

assert(
  resolveChatCreateProject({ projectIds: ['p1'] }, projects).locked === true,
  'single filter locks project',
);
assert(
  resolveChatCreateProject({ projectIds: ['p1'] }, projects).projectId === 'p1',
  'single filter picks id',
);
assert(
  resolveChatCreateProject({ projectIds: null }, [projects[0]]).locked === true,
  'one project locks',
);
assert(
  resolveChatCreateProject({ projectIds: ['p1', 'p2'] }, projects, 'p2').projectId === 'p2',
  'multi filter prefers active project',
);
assert(
  resolveChatCreateProject({ projectIds: ['p1', 'p2'] }, projects).locked === false,
  'multi filter allows picker',
);

if (!ok) process.exit(1);
console.log('resolveChatCreateProject.test OK');
