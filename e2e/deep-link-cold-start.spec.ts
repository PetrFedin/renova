import { test, expect } from '@playwright/test';

import {
  API,
  apiReachable,
  authHeaders,
  pickPrimaryDemoProject,
  seedDemoContractorSession,
  seedDemoCustomerSession,
  webReachable,
  type DemoProject,
  type DemoUser,
} from './helpers';

/**
 * Группы (customer)/(contractor) прозрачны в URL: /profile подходит обеим, и при
 * холодной загрузке expo-router выбирал (contractor). Страж группы отправлял заказчика
 * на главную. Прямая ссылка на вкладку при живой сессии обязана остаться на своём месте.
 */
const DEEP_LINKS = ['/object?tab=estimate', '/profile', '/repair?tab=materials', '/budget?tab=payments', '/calendar', '/chat'];

for (const role of ['customer', 'contractor'] as const) {
  for (const link of DEEP_LINKS) {
    test(`cold deep link ${link} stays put for ${role}`, async ({ page, request }) => {
      test.skip(!(await apiReachable()) || !(await webReachable()), 'Need API :8100 and web :8081');
      const user = (await (await request.post(`${API}/api/v1/auth/demo`, { data: { role } })).json()) as DemoUser;
      const projects = (await (await request.get(`${API}/api/v1/projects`, { headers: authHeaders(user) })).json()) as DemoProject[];
      const project = pickPrimaryDemoProject(projects);
      if (role === 'customer') await seedDemoCustomerSession(page, user.id, project.id, user.access_token);
      else await seedDemoContractorSession(page, user.id, project.id, user.access_token);

      await page.goto(link, { waitUntil: 'domcontentloaded' });
      const expected = new URL(link, 'http://x');
      // Redirect из стража случается через несколько секунд после восстановления сессии.
      await page.waitForTimeout(7_000);
      const now = new URL(page.url());
      expect(now.pathname, `${role}: ${link} must not bounce to home`).toBe(expected.pathname);
      expect(now.search, `${role}: ${link} must keep its query`).toBe(expected.search);
    });
  }
}
