import fs from 'node:fs';

const workflowPath = '.github/workflows/ci.yml';
const runnerPath = 'scripts/ci-golden-paths.sh';
const workflow = fs.readFileSync(workflowPath, 'utf8');
const runner = fs.readFileSync(runnerPath, 'utf8');

const start = workflow.indexOf('\n  golden-paths:');
if (start < 0) throw new Error('CI must define the golden-paths job');

const tail = workflow.slice(start + 1);
const nextJob = tail.slice(2).search(/\n  [a-zA-Z0-9_-]+:\n/);
const block = nextJob >= 0 ? tail.slice(0, nextJob + 2) : tail;

if (/continue-on-error\s*:\s*true/.test(block)) {
  throw new Error('golden-paths must be blocking: continue-on-error=true is forbidden');
}
if (!/run:\s*bash scripts\/ci-golden-paths\.sh/.test(block)) {
  throw new Error('golden-paths must execute the canonical Golden Paths runner');
}
if (!/if \[ "\$api_status" -ne 0 \] \|\| \[ "\$mobile_status" -ne 0 \]; then[\s\S]*?exit 1/.test(runner)) {
  throw new Error('Golden Paths runner must fail when API or mobile-web journeys fail');
}

console.log('Golden Paths release gate is blocking and fail-closed.');
