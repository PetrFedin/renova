# Renova — sheet motion accessibility contract

**Статус:** ACTIVE / governed annex  
**Область:** shared `SheetSurface`  
**Связь:** #305 mobile design/interaction integrity

## Intent

Bottom sheets are occasional hierarchical surfaces, so the existing slide presentation is preserved for normal motion settings. System Reduced Motion removes the large translation while retaining a simple fade so the state change remains legible.

## Contract

- source of system preference: `react-native-reanimated` `useReducedMotion()` already available in the mobile stack;
- normal preference: `Modal` presentation remains `slide`;
- Reduced Motion: presentation becomes `fade`;
- no custom per-screen motion policy is allowed for callers of `SheetSurface`;
- safe close, busy guard, keyboard avoidance, scroll body, sticky footer, safe-area padding and modal accessibility remain unchanged;
- no new animation library or gesture behavior is introduced by this change.

## Verification

- `clarityWaveB.w154.test.ts` locks the shared Reduced Motion behavior and is part of the existing mobile test command;
- `sheetChromeContract.test.ts` locks the same source contract for the shared chrome;
- `typecheck:mobile` must remain green;
- device-level animation feel is not claimed as externally verified from source/CI alone.
