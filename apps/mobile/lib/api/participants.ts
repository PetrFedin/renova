/** API: project participants (mandate B6 — first mobile consumer of the w22 participant API).
 *
 * Backend: GET/POST /projects/{id}/participants, PATCH .../{pid}/scopes, DELETE .../{pid}.
 * Mutations are owner-only on the server; ACL errors surface as ApiError(403/404) per AGENTS.md §9.
 * Deliberately NOT queued offline: adding/removing people must be an online, acknowledged action
 * (see #316 — no queued POST without a server-side idempotency contract).
 */
import { req } from './client';
import type { ParticipantMutation, ParticipantScope, ProjectParticipant } from './types/participants';

const base = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/participants`;

export const participantsApi = {
  list: (userId: string, projectId: string, opts?: { includeRemoved?: boolean }) =>
    req<ProjectParticipant[]>(`${base(projectId)}${opts?.includeRemoved ? '?include_removed=true' : ''}`, {}, userId),

  add: (userId: string, projectId: string, body: { contractor_id: string; scopes?: ParticipantScope[] }) =>
    req<ParticipantMutation>(base(projectId), { method: 'POST', body: JSON.stringify({ contractor_id: body.contractor_id, scopes: body.scopes ?? [] }) }, userId),

  replaceScopes: (userId: string, projectId: string, participantId: string, scopes: ParticipantScope[]) =>
    req<ProjectParticipant>(`${base(projectId)}/${encodeURIComponent(participantId)}/scopes`, { method: 'PATCH', body: JSON.stringify({ scopes }) }, userId),

  remove: (userId: string, projectId: string, participantId: string) =>
    req<ProjectParticipant>(`${base(projectId)}/${encodeURIComponent(participantId)}`, { method: 'DELETE' }, userId),
};
