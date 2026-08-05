import { test, expect, type Page } from '@playwright/test';
import {
  API,
  apiReachable,
  authHeaders,
  pickPrimaryDemoProject,
  webReachable,
  type DemoUser,
} from './helpers';

const OUTBOX_ID = '11111111-1111-1111-1111-111111111111';
const CLAIM_TOKEN = 'e2e-secret-claim-token-must-not-render';
const PAYLOAD_SECRET = 'provider-token-must-not-render';
const DEAD_LETTER_API = /\/api\/v1\/admin\/outbox\/dead-letters(?:\/[^?]*)?(?:\?.*)?$/;

async function installSession(page: Page, user: DemoUser, projectId: string, role: 'contractor' | 'customer') {
  await page.addInitScript(
    ({ uid, pid, tok, sessionRole }) => {
      localStorage.setItem('renova_user_id', uid);
      localStorage.setItem('renova_project_id', pid);
      localStorage.setItem('renova_user_role', sessionRole);
      localStorage.setItem('renova_detail_quiz_done', '1');
      localStorage.setItem('renova_project_explicitly_picked', '1');
      localStorage.removeItem('renova_pending_project_pick');
      if (tok) localStorage.setItem('renova_access_token', tok);
    },
    {
      uid: user.id,
      pid: projectId,
      tok: user.access_token?.trim() || '',
      sessionRole: role,
    },
  );
}

function safeItem(claimed: boolean) {
  return {
    id: OUTBOX_ID,
    aggregate_type: 'notification',
    aggregate_id: 'recipient-safe-id',
    event_type: 'notification.created',
    created_at: '2026-08-05T12:00:00Z',
    attempts: 8,
    max_attempts: 8,
    error_code: 'internal_delivery_error',
    error_fingerprint: '0123456789abcdef',
    payload_size_bytes: 812,
    claim_state: claimed ? 'claimed_self' : 'unclaimed',
    claim_owner: claimed ? 'self' : null,
    claim_expires_at: claimed ? '2099-01-01T00:00:00Z' : null,
    replayable: true,
  };
}

test.describe('Outbox dead-letter operator console', () => {
  test.beforeEach(async () => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need API :8100 and web :8081');
  });

  test('administrator claims, audits and replays one event without rendering secrets', async ({ page, request }) => {
    const contractor = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'contractor' } })
    ).json()) as DemoUser;
    const projects = await (
      await request.get(`${API}/api/v1/projects`, { headers: authHeaders(contractor) })
    ).json();
    const projectId = pickPrimaryDemoProject(projects).id;
    await installSession(page, contractor, projectId, 'contractor');

    let claimed = false;
    let delivered = false;
    let replayBody: Record<string, unknown> | null = null;

    await page.route('**/api/v1/admin/release-health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          crash_free_rate: 100,
          integrations: {
            outbox: {
              status: delivered ? 'healthy' : 'critical',
              healthy: delivered,
              poisoned: delivered ? 0 : 1,
              retryable: 0,
              stale_leases: 0,
              dead_letter_recovery_ready: true,
            },
          },
        }),
      });
    });

    // A Playwright glob ending in `dead-letters**` does not match nested paths
    // reliably. Use one anchored regex so list, claim, history and replay are
    // all guaranteed to stay inside the deterministic browser contract.
    await page.route(DEAD_LETTER_API, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const pathname = url.pathname;

      if (pathname.endsWith(`/${OUTBOX_ID}/claim`) && method === 'POST') {
        claimed = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            claim_token: CLAIM_TOKEN,
            claim_expires_at: '2099-01-01T00:00:00Z',
            replayed: false,
          }),
        });
        return;
      }

      if (pathname.endsWith(`/${OUTBOX_ID}/replay`) && method === 'POST') {
        replayBody = route.request().postDataJSON() as Record<string, unknown>;
        delivered = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: OUTBOX_ID,
            requeued: true,
            dispatch: { status: 'delivered' },
          }),
        });
        return;
      }

      if (pathname.endsWith(`/${OUTBOX_ID}/history`) && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                actor_user_id: contractor.id,
                action: 'claim',
                status_code: 200,
                created_at: '2026-08-05T12:01:00Z',
              },
            ],
          }),
        });
        return;
      }

      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            total: delivered ? 0 : 1,
            limit: 100,
            offset: 0,
            items: delivered ? [] : [safeItem(claimed)],
            payload_json: `{"token":"${PAYLOAD_SECRET}"}`,
            last_error: `smtp password ${PAYLOAD_SECRET}`,
          }),
        });
        return;
      }

      await route.fulfill({ status: 404, body: '{}' });
    });

    await page.goto('/outbox-dead-letters');
    await expect(page.getByText('Очередь восстановления')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('notification.created', { exact: true })).toBeVisible();
    await expect(page.getByText('internal_delivery_error', { exact: false })).toBeVisible();
    await expect(page.getByText(PAYLOAD_SECRET)).toHaveCount(0);
    await expect(page.getByText(CLAIM_TOKEN)).toHaveCount(0);

    await page.getByRole('button', { name: 'Взять в работу' }).click();
    await expect(page.getByText('Взято вами')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторить доставку' })).toBeVisible();
    await expect(page.getByText(CLAIM_TOKEN)).toHaveCount(0);

    await page.getByRole('button', { name: 'История' }).click();
    await expect(page.getByText('История операторских действий')).toBeVisible();
    await expect(page.getByText('claim', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Повторить доставку' }).click();
    await expect(page.getByRole('button', { name: 'Подтвердить повтор' })).toBeVisible();
    await page.getByRole('button', { name: 'Подтвердить повтор' }).click();

    await expect(page.getByText('Доставка выполнена')).toBeVisible();
    await expect(page.getByText('Проблемных событий нет')).toBeVisible();
    expect(replayBody).toEqual({ claim_token: CLAIM_TOKEN, dispatch_now: true });
    await expect(page.getByText(CLAIM_TOKEN)).toHaveCount(0);
    await expect(page.getByText(PAYLOAD_SECRET)).toHaveCount(0);
  });

  test('customer sees fail-closed access error and no dead-letter metadata', async ({ page, request }) => {
    const customer = (await (
      await request.post(`${API}/api/v1/auth/demo`, { data: { role: 'customer' } })
    ).json()) as DemoUser;
    const projects = await (
      await request.get(`${API}/api/v1/projects`, { headers: authHeaders(customer) })
    ).json();
    const projectId = pickPrimaryDemoProject(projects).id;
    await installSession(page, customer, projectId, 'customer');

    await page.route('**/api/v1/admin/**', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ detail: { code: 'admin_role_forbidden' } }),
      });
    });

    await page.goto('/outbox-dead-letters');
    await expect(page.getByText('Операционный доступ запрещён для этой учётной записи.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('notification.created')).toHaveCount(0);
    await expect(page.getByText(PAYLOAD_SECRET)).toHaveCount(0);
  });
});
