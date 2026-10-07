import { expect, test } from '@playwright/test';
import {
  API, apiReachable, authHeaders, pickPrimaryDemoProject,
  seedDemoCustomerSession, seedDemoContractorSession, webReachable,
  type DemoProject, type DemoUser,
} from './helpers';

async function demoUser(request: any, role: 'customer' | 'contractor') {
  const user = (await (
    await request.post(`${API}/api/v1/auth/demo`, { data: { role } })
  ).json()) as DemoUser;
  const projects = (await (
    await request.get(`${API}/api/v1/projects`, { headers: authHeaders(user) })
  ).json()) as DemoProject[];
  const project = pickPrimaryDemoProject(projects);
  expect(project?.id).toBeTruthy();
  return { user, project };
}

async function seedCustomer(page: any, request: any) {
  const { user, project } = await demoUser(request, 'customer');
  await seedDemoCustomerSession(page, user.id, project.id, user.access_token);
}

async function seedContractor(page: any, request: any) {
  const { user, project } = await demoUser(request, 'contractor');
  await seedDemoContractorSession(page, user.id, project.id, user.access_token);
}

for (const viewport of [
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
] as const) {
  test(`customer profile form stays compact @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedCustomer(page, request);
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });

    for (const placeholder of ['Телефон', 'Код профиля']) {
      const field = page.locator(`input[placeholder="${placeholder}"]`);
      await expect(field).toBeVisible({ timeout: 15_000 });
      const box = await field.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(520.5);
    }
  });

  test(`contractor profile form stays compact @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedContractor(page, request);
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('input[placeholder="Код объекта"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[placeholder="Название ИП / ООО"]')).toBeVisible({ timeout: 15_000 });

    const codeBox = await page.locator('input[placeholder="Код объекта"]').boundingBox();
    expect(codeBox).not.toBeNull();
    expect(codeBox!.width).toBeLessThanOrEqual(520.5);

    const editable = page.locator('input[placeholder]:not([placeholder=""]), textarea[placeholder]:not([placeholder=""])');
    const count = await editable.count();
    expect(count).toBeGreaterThan(4);
    for (let i = 0; i < count; i += 1) {
      const box = await editable.nth(i).boundingBox();
      if (!box) continue;
      expect(box.width, `contractor profile field ${i} too wide`).toBeLessThanOrEqual(620.5);
    }
  });

  test(`workspace search may use full row @ ${viewport.name}`, async ({ page, request }) => {
    test.skip(!(await apiReachable()) || !(await webReachable()), 'Need local runtime');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedCustomer(page, request);
    await page.goto('/object', { waitUntil: 'domcontentloaded' });

    const search = page.locator('input[placeholder="Поиск…"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    const box = await search.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(viewport.name === 'desktop' ? 800 : 600);
  });
}
