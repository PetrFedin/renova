/**
 * W98: chat-task sync + week/plan/activity/admin reload.
 * Run: npx tsx apps/mobile/lib/useProjectDataReload.w98.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

const chat = readFileSync(join(root, 'components/renova/chat/ChatThreadView.tsx'), 'utf8');
if (!chat.includes('taskFromChatMessage') || !chat.includes('syncProjectSideEffects')) {
  throw new Error('ChatThreadView must sync after taskFromChatMessage');
}
if (!chat.includes('W98:')) throw new Error('expected W98 sync comment near task create');

for (const rel of [
  'components/renova/os/WeekScheduleStrip.tsx',
  'components/screens/object/PlanTabOverview.tsx',
  'components/renova/chat/ChatTaskSheet.tsx',
  'app/activity.tsx',
  'app/(contractor)/_screens/admin-dashboard.tsx',
]) {
  const src = readFileSync(join(root, rel), 'utf8');
  if (!src.includes('useProjectDataReload')) {
    throw new Error(`W98 missing useProjectDataReload: ${rel}`);
  }
}

console.log('useProjectDataReload.w98.test OK');
