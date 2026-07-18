/** API: rooms */
import { req, cachedGet, API_BASE, OFFLINE_ROOMS, ApiError } from './client';
import type { Room, RoomChangeRequest, RoomSnapshot, User } from './types';
export const roomsApi = {
  listRooms: async (userId: string, projectId: string, opts?: { archived?: boolean }) => {
    const qs = opts?.archived ? '?archived=true' : '';
    try {
      const r = await req<Room[]>(`/api/v1/projects/${projectId}/rooms${qs}`, {}, userId);
      const filtered =
        opts?.archived === undefined
          ? r
          : r.filter((room) => Boolean(room.is_archived) === opts.archived);
      if (typeof localStorage !== 'undefined') localStorage.setItem(`${OFFLINE_ROOMS}:${projectId}`, JSON.stringify(r));
      return filtered;
    } catch {
      if (typeof localStorage !== 'undefined') { const c = localStorage.getItem(`${OFFLINE_ROOMS}:${projectId}`); if (c) return JSON.parse(c); }
      throw new Error('offline');
    }
  },
  listRoomsRaw: (userId: string, projectId: string) => req<Room[]>(`/api/v1/projects/${projectId}/rooms`, {}, userId),
  updateRoom: async (userId: string, projectId: string, roomId: string, body: object) => {
    try {
      return await req<Room>(`/api/v1/projects/${projectId}/rooms/${roomId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/rooms/${roomId}`, method: 'PATCH', body: JSON.stringify(body), userId });
      throw new Error('offline_queued');
    }
  },
  createRoom: (userId: string, projectId: string, body: object) =>
    req<Room>(`/api/v1/projects/${projectId}/rooms`, { method: 'POST', body: JSON.stringify(body) }, userId),
  roomSnapshot: (userId: string, projectId: string, roomId: string) => req<RoomSnapshot>(`/api/v1/projects/${projectId}/rooms/${roomId}/snapshot`, {}, userId),
  roomChangeLog: (userId: string, projectId: string, roomId: string, field?: string, since?: string) => {
    const q = new URLSearchParams();
    if (field) q.set('field', field);
    if (since) q.set('since', since);
    const qs = q.toString();
    return req<{ field: string; old: string; new: string; at: string }[]>(`/api/v1/projects/${projectId}/rooms/${roomId}/change-log${qs ? `?${qs}` : ''}`, {}, userId);
  },
  calcRoomMaterials: (userId: string, projectId: string, roomId: string) => req<{ room_id: string; items: { name: string; unit: string; qty: number; category: string; note?: string }[] }>(`/api/v1/projects/${projectId}/rooms/${roomId}/calc-materials`, { method: 'POST' }, userId),
  exportRoomPdf: async (userId: string, projectId: string, roomId: string) => {
    const { downloadApiPath } = await import('@/lib/downloadFile');
    await downloadApiPath(userId, `/api/v1/projects/${projectId}/rooms/${roomId}/export.pdf`, `room-${roomId.slice(0, 8)}.pdf`);
  },
  exportRoomAuditPdf: async (userId: string, projectId: string, roomId: string) => {
    const { downloadApiPath } = await import('@/lib/downloadFile');
    await downloadApiPath(userId, `/api/v1/projects/${projectId}/rooms/${roomId}/audit.pdf`, `audit-${roomId.slice(0, 8)}.pdf`);
  },
  listRoomChangeRequests: (userId: string, projectId: string) =>
    req<RoomChangeRequest[]>(`/api/v1/projects/${projectId}/room-change-requests`, {}, userId),
  createRoomChangeRequest: async (userId: string, projectId: string, body: object) => {
    try {
      return await req(`/api/v1/projects/${projectId}/room-change-requests`, { method: 'POST', body: JSON.stringify(body) }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/room-change-requests`, method: 'POST', body: JSON.stringify(body), userId });
      throw new Error('offline_queued');
    }
  },
  approveRoomChange: async (userId: string, projectId: string, reqId: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/room-change-requests/${reqId}/approve`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/room-change-requests/${reqId}/approve`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
  rejectRoomChange: async (userId: string, projectId: string, reqId: string) => {
    try {
      return await req(`/api/v1/projects/${projectId}/room-change-requests/${reqId}/reject`, { method: 'POST' }, userId);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/room-change-requests/${reqId}/reject`, method: 'POST', body: '{}', userId });
      throw new Error('offline_queued');
    }
  },
};
