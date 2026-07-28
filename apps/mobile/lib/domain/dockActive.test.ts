/** resolveDockItemActive — object/estimate не оба active */
import { resolveDockItemActive } from './dockActive';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const setup = ['home', 'chat', 'object', 'estimate', 'contractor'] as const;

assert(
  resolveDockItemActive({ id: 'estimate', seg: 'object', section: 'object', hubTab: 'estimate', items: setup }),
  'estimate active on hubTab=estimate',
);
assert(
  !resolveDockItemActive({ id: 'object', seg: 'object', section: 'object', hubTab: 'estimate', items: setup }),
  'object not active when estimate selected',
);
assert(
  resolveDockItemActive({ id: 'object', seg: 'object', section: 'object', hubTab: 'rooms', items: setup }),
  'object active on rooms',
);
assert(
  !resolveDockItemActive({ id: 'estimate', seg: 'object', section: 'object', hubTab: 'rooms', items: setup }),
  'estimate not active on rooms',
);

const repairOnly = ['home', 'chat', 'object', 'repair', 'budget'] as const;
assert(
  resolveDockItemActive({ id: 'object', seg: 'object', section: 'object', hubTab: 'estimate', items: repairOnly }),
  'object stays active on estimate tab if estimate not in dock',
);

console.log('dockActive.test OK');
