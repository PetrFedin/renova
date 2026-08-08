import { readFileSync } from 'node:fs';

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const context = readFileSync('apps/mobile/lib/context/RenovaContext.tsx', 'utf8');

must(
  !context.includes('.catch(() => undefined)'),
  'nonblocking session side effects must stay observable instead of resolving silently',
);
must(
  context.includes("reportError('renovaContext.ensureActiveProject'"),
  'automatic project recovery failure must be observable',
);
must(
  context.includes("reportError('renovaContext.bootstrap'"),
  'bootstrap failure must be observable instead of silently presenting a ready shell',
);
must(
  context.includes("reportError('renovaContext.offlineFlush'"),
  'offline outbox flush failure must be observable',
);
must(
  context.includes("reportError('renovaContext.demoLogin.projects'"),
  'demo login project-load failure must be observable',
);
must(
  !/demoLogin[\s\S]{0,1800}catch\s*\{\s*list\s*=\s*\[\];\s*\}/.test(context),
  'demo login must not turn project-load failure into a fabricated empty project list',
);

console.log('sessionFailureTruth.w181.test OK');
