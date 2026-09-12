# Renova — Dock navigation stability contract

**Статус:** ACTIVE / governed migration annex  
**Область:** `OsDockBar`, `dockBarPrefs`, historical dynamic presets  
**Связь:** issue #399, #305 interaction consistency

## Product decision

Primary navigation does not rearrange itself automatically when project phase, setup progress or detail level changes.

Production policy:

1. Without a saved preference, Dock uses the canonical default:
   `Главная | Сообщения | Объект | Ремонт | Деньги`.
2. Explicit user customization through `DockBarSettings` remains supported and authoritative.
3. Context may change badges, attention and content inside canonical hubs, but does not silently move/replace primary destinations.
4. Calendar/Сроки remains an allowed explicit optional Dock choice and remains reachable through canonical routes regardless of Dock membership.

This preserves muscle memory while retaining user agency.

## Historical dynamic presets

`resolveDynamicDock.ts` and setup/repair preset constants are retained temporarily with `LEGACY-RETAINED #399` because deletion requires full reference/removal proof. Production `OsDockBar` no longer consumes them automatically.

Retaining the helpers is not permission to re-enable runtime automatic rearrangement. Future removal or reuse requires a separate bounded change and updated navigation evidence.

## Invariants

- `routeRegistry.ts` remains navigation SoT;
- no canonical route is removed;
- saved Dock preferences continue to load and receive live setting changes through `subscribeDockBar`;
- Home and Chat remain mandatory under existing preference normalization;
- role-aware labels/badges and active-state detection remain unchanged;
- project switch, setup→repair phase change and detail-level change alone must not mutate Dock composition.

## Verification

- existing `resolveDynamicDock.test.ts` retains historical resolver determinism and now asserts production `OsDockBar` is preference/default driven;
- `routeRegistry.test.ts`, `osTabNav.test.ts`, mobile typecheck and hub-navigation integrity must remain green;
- customer/contractor routes and deep links remain unchanged;
- this source/CI evidence is not a claim of external device usability verification.

## Non-goals

- no removal of Calendar;
- no removal of explicit Dock customization;
- no new top-level hub;
- no change to project phase/detail-level domain logic;
- no visual redesign of the Dock;
- no migration or deletion of existing AsyncStorage preference values.
