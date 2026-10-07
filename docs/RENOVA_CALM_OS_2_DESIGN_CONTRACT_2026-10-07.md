# Renova Calm Construction OS 2.0 — Design Contract

**Date:** 2026-10-07  
**Status:** PROPOSED / DESIGN SYSTEM CONTRACT  
**Implementation gate:** do not implement before #683 admission and #668 Verified Execution Record requalification.

## 1. North star

Renova should feel like a **calm architectural control room**, not an ERP dashboard and not a consumer-fintech app.

The interface optimises for:

- fast comprehension;
- one obvious next decision;
- visible evidence;
- spatial context when useful;
- low visual noise;
- truthful pending/offline/error state;
- confidence for money, acceptance and quality decisions.

Existing slate/blue identity remains the base.

## 2. Design principles

1. **Evidence before decoration.**
2. **One primary CTA per view.**
3. **Lists before card walls.**
4. **Spatial canvas only when it reduces mental work.**
5. **Progressive disclosure for dense construction detail.**
6. **Status is semantic, never colour-only.**
7. **Motion explains continuity; it never fakes completion.**
8. **Role changes information density, not truth.**
9. **Offline/queued/server-confirmed states are visibly different.**
10. **Premium means precision, speed and hierarchy — not gradients everywhere.**

## 3. Proposed responsive modes

These are target design breakpoints, not claims about current implementation.

| Mode | Proposed viewport | Primary structure |
|---|---:|---|
| Phone narrow | < 480 px | single task + bottom sheet |
| Phone wide | 480–767 px | single column + richer media |
| Tablet portrait | 768–1023 px | list/canvas + overlay inspector |
| Tablet landscape | 1024–1279 px | 2-column workspace |
| Desktop | 1280–1599 px | nav rail + primary workspace + optional inspector |
| Large monitor | >= 1600 px | nav rail + large canvas + persistent decision/evidence rail |

Do not expose different business routes by viewport. Layout changes projection only.

## 4. Desktop / monitor shell

Target composition:

`56–72 px global rail | fluid primary workspace | 320–400 px context rail`

### Left rail

- project switcher;
- Home;
- Object;
- Works/Schedule;
- Budget;
- Messages;
- Documents;
- Quality;
- More.

Collapsed icon-only state may exist on smaller desktop widths.

### Primary workspace

Depending on route:

- dense list;
- plan;
- 360;
- BIM/3D;
- timeline;
- schedule;
- comparison;
- document/evidence viewer.

### Right context rail

Shows only the selected entity:

- status;
- next decision;
- evidence;
- money impact where authorised;
- comments/history;
- related issue/RFI/inspection;
- primary action.

No global dashboard should permanently occupy the right rail.

## 5. Tablet shell

### Portrait

- primary list/canvas full width;
- inspector as half-height or side sheet;
- project/path context fixed;
- pen-friendly markup and review controls.

### Landscape

- 40–45% list / 55–60% content where list+detail is useful;
- spatial canvas may take 65–75% with compact inspector.

## 6. Phone shell

Phone remains the most disciplined mode.

Rules:

- one primary task;
- one primary CTA;
- fixed current project + current room/work-package context where applicable;
- bottom sheet for secondary detail;
- no three-column logic collapsed into stacked cards;
- camera/voice/issue quick actions available in Site Mode;
- destructive/high-risk action always opens a review surface before commit.

## 7. Density modes

### Comfortable

Default customer/mobile mode.

- 44–48 px minimum interactive row height;
- generous vertical rhythm;
- descriptive secondary text.

### Compact

Contractor/manager/desktop operations.

- denser rows;
- secondary metadata inline where legible;
- same touch/keyboard accessibility;
- never reduce critical status visibility.

### Presentation

Investor/client/meeting review.

- larger titles/metrics;
- one narrative decision at a time;
- secondary controls suppressed;
- evidence drill-down still available.

## 8. Surface hierarchy

Proposed semantic layers:

1. **Canvas** — page/background.
2. **Base surface** — ordinary content.
3. **Raised surface** — card/inspector.
4. **Floating tool surface** — spatial toolbar/filter.
5. **Sheet/modal** — temporary focused task.
6. **Critical overlay** — destructive/security/high-risk confirmation.

Prefer borders and subtle tonal separation to heavy shadows.

## 9. Spacing system

Keep the current 4/8 rhythm.

Allowed primary spacing increments:

- 4;
- 8;
- 12;
- 16;
- 20;
- 24;
- 32.

New UI should not introduce arbitrary 13/17/19/27 px spacing unless required by native/platform geometry.

## 10. Typography hierarchy

Preserve current Renova type scale and extend semantic usage.

### Display

Only:

- project headline KPI;
- presentation mode;
- selected large value.

### H1

One per screen/workspace.

### H2

Major decision/section.

### List title

Primary object identity.

### Body

Actionable/context text.

### Caption/meta

Source/date/version/status metadata.

### Metric

Money/progress/quantity.

No uppercase section shouting. Avoid faux-technical monospace in normal user UI.

## 11. Status language

Use status pills plus plain language.

Examples:

- Черновик
- Отправлено
- Ждёт решения
- Принято
- Нужна доработка
- Просрочено
- Заблокировано
- Офлайн — сохранено на устройстве
- В очереди
- Отправляется
- Подтверждено сервером

Never show raw enum/API terms to ordinary users.

## 12. Evidence visual language

Every evidence-like object may expose:

- **Оригинал**
- **Производное**
- **Проверено**
- **Допущено**
- **Принято**
- **Заменено**
- **Отозвано**

Visual distinction must survive greyscale and colour-vision differences.

Original and annotated/AI-derived versions should never be visually indistinguishable.

## 13. Spatial Control Room

One shared chrome for 2D plan / 3D / BIM / 360.

### Top context bar

- project;
- floor;
- room/zone;
- date/timeline;
- compare state.

### Left/lightweight toolbar

- layers;
- issues;
- RFI;
- inspections;
- evidence;
- planned/actual;
- measurement/markup where authorised.

### Canvas

Renderer-specific content only.

### Right inspector

Selected object / work / issue / asset:

- identity;
- progress;
- evidence;
- blockers;
- cost/context;
- acceptance;
- history;
- next action.

### Timeline

Scrub between admitted capture dates.

Compare modes:

- T1/T2;
- planned/actual;
- original/annotated;
- model/reality.

## 14. Site Mode

Site Mode is not a colour theme. It is an operational interaction mode.

### Persistent context

- project;
- current room/zone;
- work package;
- offline/sync status.

### Capture dock

Primary quick actions:

- Photo;
- Video/360;
- Voice;
- Issue;
- Markup/measurement where available.

### Field constraints

- one-handed use;
- large targets;
- high contrast/sunlight readability;
- minimal text entry;
- capture continues offline;
- explicit queued/server-confirmed distinction;
- haptics for captured/queued/confirmed where platform permits.

## 15. Media experience

### Lists

Use:

- fixed thumbnail aspect ratio;
- small derivative, never original;
- placeholder geometry to prevent layout jump.

### Detail

Progressive resolution:

`thumbnail -> preview -> full source on demand`

### Compare

Provide:

- swipe slider where semantically useful;
- side-by-side on large screens;
- same-room/date navigation;
- source date/room/work context fixed.

### 360 / 3D

Show useful first frame before secondary layers.

Critical project UI must remain usable if the renderer fails.

## 16. Chart semantics

No decorative dashboards.

### Actual vs plan

- actual = solid;
- plan = secondary/outlined;
- forecast = distinct dashed/uncertainty presentation.

### Zero vs unknown

- zero is a value;
- unknown is missing;
- unavailable is dependency state.

They must never share the same visual treatment.

### Confidence

Predictive chart must show:

- confidence/coverage;
- observation freshness;
- forecast interval/range where applicable.

### Accessibility

Every chart has:

- exact values;
- screen-reader summary;
- table/list fallback;
- semantic labels independent of colour.

## 17. Proposed motion tokens

These are target values for future implementation.

| Token | Target | Use |
|---|---:|---|
| instant | 80–120 ms | press/state feedback |
| fast | 140–180 ms | chip/filter/small reveal |
| standard | 180–240 ms | sheet/panel navigation |
| spatial | 240–320 ms | room/canvas/context transition |
| progress | variable | real progress only |

Rules:

- respect reduced motion;
- no decorative infinite animation;
- no optimistic "success" animation before authoritative commit;
- cancellation/error interrupts motion immediately;
- spatial transition must preserve user orientation.

## 18. Loading/state system

### Skeleton

Only when target layout is known.

### Background refresh

Retain current data and show quiet freshness state.

### Blocking action

Use explicit progress with disabled duplicate action.

### Offline queued

Show:

- saved locally;
- not yet confirmed;
- retry/sync state.

### Dependency failure

Show retained safe data + retry where possible.

Never render fabricated zero/empty success state because a dependency failed.

## 19. Accessibility contract

Required:

- minimum 44 px touch target;
- dynamic text scaling;
- keyboard/focus-visible web behavior;
- reduced motion;
- high contrast;
- screen-reader labels for icon/spatial controls;
- charts not colour-only;
- focus order follows visual/decision order;
- field capture works without fine motor precision.

## 20. Proposed visual performance budgets

These are engineering **targets**, not current measured performance.

### Core non-3D routes

- warm route transition: target p75 <= 250 ms to useful content;
- interaction feedback: <= 100 ms;
- long-list scroll: no sustained user-visible jank;
- image lists: thumbnail derivatives only.

### Media

- preview image useful render: target p75 <= 500 ms on warm cache / representative network;
- full media is progressive and cancellable.

### Spatial

- 360 first useful frame: target p75 <= 1.5 s after route data is available;
- BIM/3D first useful frame: target p75 <= 2.5 s on supported mid-tier device;
- secondary layers load after navigation/control becomes usable.

Targets must be validated on representative low/mid/high device classes before being claimed.

## 21. Screenshot qualification matrix

Critical journeys should have stable structural screenshot checks for:

### Customer

- Home;
- Stage detail;
- Acceptance;
- Payment;
- Documents;
- Issue;
- Property Passport.

### Contractor

- Home;
- Work list;
- Schedule;
- Materials;
- Team;
- Quality;
- Site Mode.

### Supervisor

- inspection list;
- inspection detail;
- issue/hold point;
- evidence compare.

### Viewports

- phone narrow;
- tablet portrait;
- tablet landscape;
- desktop 1280;
- large monitor >=1600.

Mask volatile timestamps/IDs/data while retaining layout/status/action structure.

## 22. Design-system implementation order

1. responsive tokens;
2. density tokens;
3. depth/surface tokens;
4. motion + reduced-motion;
5. shared loading/error/stale states;
6. semantic chart primitives;
7. shared spatial chrome;
8. Site capture dock;
9. screenshot matrix;
10. performance instrumentation and budgets.

Do not start by redesigning every screen.

## 23. Visual anti-patterns

Reject:

- glassmorphism as default surface language;
- excessive gradients;
- giant shadows;
- dashboard card grids for ordinary lists;
- animated numbers that obscure actual values;
- 3D for tasks better solved by a list;
- hidden controls requiring hover on mobile;
- tiny icon-only critical actions;
- colour-only status;
- "AI sparkle" decoration without meaningful AI capability;
- dark mode used as a substitute for visual hierarchy.

## 24. Definition of Done for Calm OS 2.0

A visual-system phase is qualified only when:

- phone/tablet/desktop structural screenshots pass;
- no critical CTA/status is clipped;
- accessibility gates pass;
- reduced-motion path works;
- offline/error truth remains visible;
- visual performance budgets are measured;
- no new local colour/component fork is introduced without documented reason;
- the same canonical business state is rendered across all viewport modes.
