/**
 * P1 #273 — public chat write retry/idempotency contract (API E2E).
 */
import { test, expect } from '@playwright/test';
import { API, authHeaders, cleanupE2eGateProject, type DemoUser } from './helpers';

test.describe('P1 chat message idempotency', () => {
  test('same client request replays one message and changed payload conflicts', async ({ request }) => {
    const auth = await request.post(`${API}/api/v1/auth/demo`, {
      data: { role: 'customer' },
    });
    expect(auth.ok()).toBeTruthy();
    const customer = (await auth.json()) as DemoUser;
    const headers = authHeaders(customer);

    const created = await request.post(`${API}/api/v1/projects`, {
      headers,
      data: {
        name: `Chat retry object ${Date.now()}`,
        address: 'E2E chat idempotency',
        renovation_type: 'cosmetic',
        property_type: 'apartment',
        total_area_sqm: 32,
        rooms: [{ name: 'Комната', area_sqm: 18, length_m: 4.5, width_m: 4 }],
      },
    });
    expect(created.ok()).toBeTruthy();
    const projectId = ((await created.json()) as { id: string }).id;

    try {
      const createdThread = await request.post(`${API}/api/v1/projects/${projectId}/chats`, {
        headers,
        data: { title: 'E2E retry thread', topic: 'idempotency' },
      });
      expect(createdThread.ok()).toBeTruthy();
      const threadId = ((await createdThread.json()) as { id: string }).id;
      const clientRequestId = `chat-e2e-${Date.now()}-0001`;
      const body = {
        client_request_id: clientRequestId,
        text: 'One logical send',
        message_type: 'text',
      };

      const first = await request.post(
        `${API}/api/v1/projects/${projectId}/chats/${threadId}/messages`,
        { headers, data: body },
      );
      expect(first.status()).toBe(200);
      const firstMessage = (await first.json()) as { id: string };

      const replay = await request.post(
        `${API}/api/v1/projects/${projectId}/chats/${threadId}/messages`,
        { headers, data: body },
      );
      expect(replay.status()).toBe(200);
      const replayMessage = (await replay.json()) as { id: string };
      expect(replayMessage.id).toBe(firstMessage.id);

      const conflict = await request.post(
        `${API}/api/v1/projects/${projectId}/chats/${threadId}/messages`,
        {
          headers,
          data: {
            ...body,
            text: 'Different payload with the same request identity',
          },
        },
      );
      expect(conflict.status()).toBe(409);
      const conflictBody = (await conflict.json()) as { detail?: string };
      expect(conflictBody.detail).toBe('idempotency_conflict');

      const detail = await request.get(
        `${API}/api/v1/projects/${projectId}/chats/${threadId}`,
        { headers },
      );
      expect(detail.ok()).toBeTruthy();
      const thread = (await detail.json()) as {
        messages: { id: string; text?: string | null }[];
        capabilities?: {
          access_scope?: string;
          can_manage_participants?: boolean;
          can_create_task?: boolean;
        };
      };
      expect(thread.messages.filter((message) => message.text === body.text)).toHaveLength(1);
      expect(thread.messages.some((message) => message.id === firstMessage.id)).toBe(true);
      expect(thread.capabilities?.access_scope).toBe('project');
      expect(thread.capabilities?.can_manage_participants).toBe(true);
      expect(thread.capabilities?.can_create_task).toBe(true);
    } finally {
      await cleanupE2eGateProject(request, customer, projectId);
    }
  });
});
