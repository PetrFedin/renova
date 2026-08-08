/** Clarity D2: calendar day-first + chat dock-only unread + no home schedule strip */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const home = readFileSync(join(mobile, 'components/renova/os/home/HomeScreenBody.tsx'), 'utf8');
const chat = readFileSync(join(mobile, 'components/renova/chat/ChatListView.tsx'), 'utf8');
const createChat = readFileSync(join(mobile, 'components/renova/chat/CreateChatSheet.tsx'), 'utf8');
const cal = readFileSync(join(mobile, 'components/screens/schedule/UnifiedScheduleView.tsx'), 'utf8');

console.assert(!home.includes("from '@/components/renova/os/WeekScheduleStrip'"), 'home no WeekScheduleStrip import');
console.assert(home.includes("title=\"Сроки\"") && home.includes("pushTab('calendar')"), 'home schedule link');
console.assert(!chat.includes('unreadBanner') && !chat.includes("from '@/components/renova/chat/ChatBadge'"), 'chat no unread banner/badge');
console.assert(chat.includes('numberOfLines={1}') && chat.includes('chatListPreview'), 'chat 1-line preview');
console.assert(!chat.includes('Чаты ·'), 'chat tab no unread count');
console.assert(createChat.includes('filterChipStyles'), 'create chat uses shared chips');
console.assert(createChat.includes('const busyRef = useRef(false)'), 'create chat duplicate submit guard');
console.assert(createChat.includes('onRequestClose={closeSafely}'), 'create chat close guarded');
console.assert(createChat.includes('loading={busy}'), 'create chat shared loading state');
console.assert(createChat.includes('variant="ghost"') && createChat.includes('title="Отмена"'), 'create chat tertiary cancel');
console.assert(createChat.includes('minHeight: RenovaTheme.minTouch'), 'create chat participant touch target');
console.assert(cal.includes('planExpanded') && cal.includes('План-график и задачи · развернуть'), 'cal day plan collapse');
console.assert(cal.includes('filtersOpen') && cal.includes('Фильтры'), 'cal filters secondary');
console.assert(
  cal.includes('const [selectedDate') &&
    cal.includes('const [dayDetailOpen') &&
    cal.includes('setDayDetailOpen(true)') &&
    cal.includes('<ScheduleDayDetail'),
  'cal day-first detail',
);

const ok =
  !home.includes("from '@/components/renova/os/WeekScheduleStrip'") &&
  !chat.includes('unreadBanner') &&
  createChat.includes('const busyRef = useRef(false)') &&
  cal.includes('planExpanded') &&
  cal.includes('setDayDetailOpen(true)');
if (!ok) process.exit(1);
console.log('clarityWaveD.calendarChat.w157.test OK');
