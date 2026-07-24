# Renova Mobile navigation architecture

## Canonical model

The dock has exactly five visible slots. Home and Chat are mandatory; Object, Repair,
Budget and Calendar are product hubs selected by the active preset. The registry dock
contract is Home, Object, Repair, Budget and Chat; Calendar is an optional dock hub and
is offered in Header More only when it is absent from the current dock.

- Object owns rooms, plan/design and estimate.
- Repair owns stages, materials, control and acceptance.
- Budget owns payments, expenses and deviations. Its UI label is **Деньги** for a
  customer and **Бюджет** for a contractor.
- Calendar owns dates and schedule.
- Chat is a mandatory independent attention surface.
- Inbox is the only task/notification attention center.
- Documents owns customer and guest warranty claims.

`tabsRoute`, `objectTabRoute`, `repairTabRoute`, `budgetTabRoute` and
`calendarTabRoute` are the role-aware route builders. `navigationPolicy.ts` resolves
typed registry redirects, secondary navigation, exclusive dock state, labels and
warranty targets. UI surfaces consume this policy and do not invent local access rules.

## Access and secondary navigation

Authenticated menus are filtered by route audience, status, canonical route ID and
the current dock. Redirect-only and WIP routes are never advertised. Guest/read-only
Header More and Home More contain only Documents and Inbox; direct links remain
resolvable. Contractor Approvals is not advertised because decisions belong to the
customer, though compatible direct links remain valid.

Home activity is a compact summary. `/activity` is the full project history. The
contractor profile contains an Inbox summary/CTA and never loads or marks a second
notification feed.

## Inbound links and compatibility

Push, notification, legacy and catch-all links converge on the same role-aware target.
Bare `/object`, `/repair`, `/budget` and `/calendar` links are fail-soft wrappers: all
query values are decoded and transferred to Expo Router params. Static registry data
stores typed `redirectTarget` values rather than role-specific path strings.

Warranty routing is role-aware:

- customer/guest → `/documents?tab=warranty` with claim, issue, project, source and
  return context preserved;
- contractor → `/quality-control?tab=warranty&filter=warranty` with the same context.

Legacy finance, money, works, stages, materials, control, rooms, estimate, plan, more,
objects, notifications, work-schedule, work-acceptance, project-analytics, design,
warranty and warranty-claim aliases remain redirects, not product zones.

Hidden GA/Beta routes must declare a real `entryPoints` value. A deliberately inbound-
only route is marked `deeplinkOnly`; WIP routes cannot appear in user menus.

## Attention badges

`buildAttentionBadgeState` separates `chatUnread`, `inboxTaskUnread` and
`calendarTodayTasks`. Dock Chat displays chat only. Header More and the Inbox row show
both red chat and amber task indicators when both exist. Accessibility text describes
the same two values; calendar tasks never inflate Inbox.

## Forbidden practices

- bare `/repair?tab=…` (or another hub) in UI code;
- a hardcoded customer route group in shared navigation;
- direct `router.push` when inbound normalization requires `pushOsNav`;
- component-local guest filters;
- a second notification feed/store;
- manually concatenated role-aware paths;
- dropping or duplicating query values;
- a route registry that disagrees with the real dock;
- more than one active dock item;
- an Alert that describes a destination without an action.
