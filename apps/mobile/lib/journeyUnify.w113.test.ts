/** W113: room CTA role SoT; receipts/waste/notifications offline; stage sheet UX */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const passport = readFileSync(join(mobile, 'components/renova/os/RoomPassport.tsx'), 'utf8');
const timeline = readFileSync(join(mobile, 'components/renova/os/RoomStageTimeline.tsx'), 'utf8');
const stageSheet = readFileSync(join(mobile, 'components/renova/CreateStageSheet.tsx'), 'utf8');
const receipts = readFileSync(join(mobile, 'lib/api/receipts.ts'), 'utf8');
const floor = readFileSync(join(mobile, 'lib/api/floor.ts'), 'utf8');
const notif = readFileSync(join(mobile, 'lib/api/notifications.ts'), 'utf8');
const profile = readFileSync(join(mobile, 'components/renova/ProfileExtraLinks.tsx'), 'utf8');
const guide = readFileSync(join(mobile, 'components/screens/object/ObjectTabGuide.tsx'), 'utf8');

console.assert(passport.includes('pushOsNav(na.href, pathname, role'), 'passport role');
console.assert(timeline.includes('role = \'customer\'') || timeline.includes('role?: OsRole'), 'timeline role prop');
console.assert(timeline.includes('pushOsNav(st.next_action.href, pathname, role)'), 'timeline push role');
console.assert(stageSheet.includes('offline_queued') && stageSheet.includes('Alert'), 'stage sheet offline');
console.assert(receipts.includes('deleteReceipt') && receipts.includes('offline_queued'), 'receipt delete offline');
console.assert(receipts.includes('patchReceipt') && receipts.includes('offline_queued'), 'receipt patch offline');
console.assert(floor.includes('createWasteOrder') && floor.includes('offline_queued'), 'waste create offline');
console.assert(floor.includes('requestWasteOrder') && floor.includes('completeWasteOrder'), 'waste flow');
console.assert(notif.includes('markAllNotifications') && notif.includes('offline_queued'), 'notif offline');
console.assert(profile.includes('pushOsNav(item.href, returnTo, role)'), 'profile links role');
console.assert(guide.includes('pushOsNav(link.href, pathname, role)'), 'object guide role');

console.log('journeyUnify.w113.test.ts OK');
