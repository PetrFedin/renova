import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readMobile = (relativePath: string) => readFileSync(join(mobile, relativePath), 'utf8');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const workScheduleApi = readMobile('lib/api/workSchedule.ts');
const workScheduleEndpoint = readBackend('app/api/v1/project_work_schedule.py');
const workScheduleSchema = readBackend('app/schemas/project_work_schedule.py');
const workScheduleService = readBackend('app/services/project_work_schedule_service.py');
const idempotency = readBackend('app/services/client_write_idempotency.py');

// --- Work-schedule create (#462/#420) ---------------------------------------

const createStart = workScheduleApi.indexOf('createWorkSchedule: async');
const createEnd = workScheduleApi.indexOf('submitWorkSchedule:', createStart);
const createBlock = workScheduleApi.slice(createStart, createEnd);
must(createStart >= 0 && createEnd > createStart, 'work-schedule create API block exists');
must(
  createBlock.includes("createClientRequestId('work-schedule-create')"),
  'mobile mints a stable work-schedule-create request id',
);
must(createBlock.includes('client_request_id:'), 'mobile sends the request id with the schedule body');
must(createBlock.includes('const payload = JSON.stringify('), 'mobile serializes the body once, before the first attempt');
must((createBlock.match(/body: payload/g) || []).length === 2, 'online request and queued offline replay send the identical serialized body');

must(workScheduleService.includes('WORK_SCHEDULE_CREATE_SCOPE = "work_schedule.create"'), 'backend has a stable work-schedule-create scope');
must(workScheduleSchema.includes('client_request_id: str | None'), 'backend work-schedule-create schema accepts a request id');
must(
  workScheduleService.includes('replay_entity_id(') && workScheduleService.includes('commit_client_write('),
  'work-schedule create replays before an atomic commit',
);
must(
  workScheduleEndpoint.includes('IdempotencyConflict'),
  'work-schedule create endpoint catches the typed idempotency conflict',
);
must(
  workScheduleEndpoint.includes('"idempotency_conflict"'),
  'work-schedule create endpoint surfaces a typed conflict for a reused id with a different payload',
);

// --- #481: stage/dependency ACL binding -------------------------------------

must(
  workScheduleService.includes('work_schedule_item_stage_not_found'),
  'a non-project stage reference 404s instead of being copied blindly',
);
must(
  workScheduleService.includes('work_schedule_dependency_create_not_supported'),
  'create rejects any non-null dependency reference (no stable item identity yet)',
);
must(
  workScheduleService.includes('work_schedule_dependency_replace_not_supported'),
  'full-replacement update rejects a dependency pointing at an old same-schedule item',
);

// --- #420: submit replay safety ---------------------------------------------

must(
  workScheduleService.includes('work_schedule_submit_invalid_state'),
  'submitting from an illegal source state (e.g. confirmed) fails deterministically instead of silently re-submitting',
);
must(
  /with_for_update\(\)/.test(workScheduleService.slice(workScheduleService.indexOf('async def submit_schedule'))),
  'submit locks the schedule row before checking/transitioning its state',
);

// Shared idempotency ledger contract: same id + same payload replays; same id
// + different payload conflicts; a new id is always a distinct intent.
must(idempotency.includes('IdempotencyConflict'), 'ledger exposes a typed conflict for reused ids with a changed payload');
must(idempotency.includes('canonical_payload_hash'), 'ledger keys replay on a canonical payload hash, not on a full-payload equality check');

console.log('workScheduleCreateIdempotency.test OK');
