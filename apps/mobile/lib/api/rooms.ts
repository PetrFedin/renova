/** API: rooms */
import { req, cachedGet, API_BASE, OFFLINE_ROOMS } from './client';
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
    } catch {
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
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    const r = await fetch(`${base}/api/v1/projects/${projectId}/rooms/${roomId}/export.pdf`, { headers: { 'X-User-Id': userId } });
    if (!r.ok) throw new Error('export failed');
    const blob = await r.blob();
    if (typeof window !== 'undefined') { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = `room-${roomId.slice(0,8)}.pdf`; a.click(); URL.revokeObjectURL(u); }
  },
  exportRoomAuditPdf: async (userId: string, projectId: string, roomId: string) => { const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100'; const r = await fetch(`${base}/api/v1/projects/${projectId}/rooms/${roomId}/audit.pdf`, { headers: { 'X-User-Id': userId } }); if (!r.ok) throw new Error('audit pdf'); const blob = await r.blob(); if (typeof window !== 'undefined') { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = `audit-${roomId.slice(0,8)}.pdf`; a.click(); URL.revokeObjectURL(u); } },
  listRoomChangeRequests: (userId: string, projectId: string) =>
    req<RoomChangeRequest[]>(`/api/v1/projects/${projectId}/room-change-requests`, {}, userId),
  createRoomChangeRequest: (userId: string, projectId: string, body: object) =>
    req(`/api/v1/projects/${projectId}/room-change-requests`, { method: 'POST', body: JSON.stringify(body) }, userId),
  approveRoomChange: (userId: string, projectId: string, reqId: string) =>
    req(`/api/v1/projects/${projectId}/room-change-requests/${reqId}/approve`, { method: 'POST' }, userId),
  rejectRoomChange: (userId: string, projectId: string, reqId: string) =>
    req(`/api/v1/projects/${projectId}/room-change-requests/${reqId}/reject`, { method: 'POST' }, userId),
};
