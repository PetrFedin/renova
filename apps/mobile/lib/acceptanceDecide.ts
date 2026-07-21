/** W139: единый body приёмки — без fake 10/5; score только если пользователь задал явно */
import type { WorkAcceptanceDecisionIn } from '@/lib/api/workAcceptances';

export function acceptanceDecisionBody(opts?: {
  qualityScore?: number | null;
  comment?: string | null;
  createIssue?: boolean;
}): WorkAcceptanceDecisionIn {
  const body: WorkAcceptanceDecisionIn = {};
  if (opts?.qualityScore != null && Number.isFinite(opts.qualityScore)) {
    const n = Math.round(Number(opts.qualityScore));
    if (n >= 0 && n <= 10) body.quality_score = n;
  }
  const comment = opts?.comment?.trim();
  if (comment) body.comment = comment;
  if (opts?.createIssue) body.create_issue = true;
  return body;
}
