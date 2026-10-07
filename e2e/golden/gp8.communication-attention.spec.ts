import { test, expect } from '@playwright/test';
import { API, authHeaders, cleanupE2eGateProject, prepareContractGateScenario } from '../helpers';

test.describe('@golden @gp8 chat → unread attention → idempotent delivery', () => {
  test('customer message appears once to contractor and drives unread attention', async ({ request }) => {
    const s = await prepareContractGateScenario(request);
    const hC = authHeaders(s.customer);
    const hE = authHeaders(s.contractor);
    try {
      const threadResponse = await request.post(`${API}/api/v1/projects/${s.projectId}/chats`, {
        headers: hC,
        data: { title: 'Golden coordination', topic: 'coordination', client_request_id: 'gp8-thread-0001' },
      });
      expect(threadResponse.ok()).toBeTruthy();
      const threadId = ((await threadResponse.json()) as { id: string }).id;

      const payload = {
        client_request_id: 'gp8-message-0001',
        text: 'Нужно подтвердить доступ на объект завтра к 09:00',
      };
      const first = await request.post(
        `${API}/api/v1/projects/${s.projectId}/chats/${threadId}/messages`,
        { headers: hC, data: payload },
      );
      const replay = await request.post(
        `${API}/api/v1/projects/${s.projectId}/chats/${threadId}/messages`,
        { headers: hC, data: payload },
      );
      expect(first.ok()).toBeTruthy();
      expect(replay.ok()).toBeTruthy();

      const thread = await request.get(
        `${API}/api/v1/projects/${s.projectId}/chats/${threadId}`,
        { headers: hE },
      );
      expect(thread.ok()).toBeTruthy();
      const body = await thread.json();
      const matches = (body.messages ?? []).filter((m: any) => m.text === payload.text);
      expect(matches, 'Network/offline replay must not duplicate a human message').toHaveLength(1);

      const unread = await request.get(
        `${API}/api/v1/projects/${s.projectId}/chats/unread-count`,
        { headers: hE },
      );
      expect(unread.ok()).toBeTruthy();
      expect(Number((await unread.json()).count)).toBeGreaterThan(0);

      const notifications = await request.get(`${API}/api/v1/notifications`, { headers: hE });
      expect(notifications.ok()).toBeTruthy();
      const items = (await notifications.json()) as Array<{ project_id?: string; title?: string }>;
      expect(
        items.some((item) => item.project_id === s.projectId),
        'Cross-role message/action must surface in contractor attention, not only remain discoverable by opening Chat',
      ).toBeTruthy();
    } finally {
      await cleanupE2eGateProject(request, s.customer, s.projectId);
    }
  });
});
