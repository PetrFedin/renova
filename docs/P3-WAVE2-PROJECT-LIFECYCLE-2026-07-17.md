# P3 Wave 2 — Project lifecycle (archive / trash)

## Scope
- Backend: `is_archived`, `trashed_at`, bucket query `?bucket=active|archived|trashed`, lifecycle endpoints.
- Mobile: toolbar buckets in `ProjectEmptyState` + `OsProjectPicker`, card actions via `ProjectCardLifecycleIcons`.

## API
- `POST /projects/{id}/archive|unarchive|trash|restore`
- `DELETE /projects/{id}` — permanent delete (trashed only)
- `DELETE /projects/trash/empty` — empty trash (registered before `/{id}`)

## Mobile
- `useProjectBuckets` — list + counts per bucket
- `useProjectLifecycleActions` — archive/trash/restore + clears active project via `clearActiveProject()`
- Pick/select works only on `active` bucket

## Verify
```bash
cd backend && .venv/bin/python -m pytest tests/test_project_lifecycle.py -q
cd .. && npm run test:priority
```
