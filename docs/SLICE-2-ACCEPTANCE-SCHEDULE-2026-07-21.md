# Slice 2: acceptance-schedule → main

**Branch:** `release/acceptance-schedule`  
**Issue:** https://github.com/PetrFedin/renova/issues/6  
**Base:** `main` @ `v0.3.1-security-acl`  
**Depends on:** slice-1 backend (JWT/ACL already on main)

## Scope

- Unified acceptance list + decide path
- Schedule UI (UnifiedScheduleView, day detail, status guard)
- Works/stage fail-closed + project data reload
- OS tabs infinite-loop fix (`OsTabsLayoutOptions` / `OsDockBar`)
- Offline sync status on acceptance surfaces

## Not in this PR

- Full payments / portal / IA (later slices)
- Mega-PR #3

## DoD

- [ ] CI green
- [ ] Tag `v0.3.2-acceptance-schedule`
