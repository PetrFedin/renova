import {
  expect,
  request as playwrightRequest,
  type APIResponse,
  type Page,
} from '@playwright/test';
import {
  API,
  authHeaders,
  pickPrimaryDemoProject,
  seedDemoContractorSession,
  seedDemoCustomerSession,
  type DemoProject,
  type DemoUser,
} from '../../../../e2e/helpers';

export { API, authHeaders };

async function readJson<T>(response: APIResponse, label: string): Promise<T> {
  const body = await response.text();
  expect(
    response.ok(),
    `${label} failed: HTTP ${response.status()} ${response.statusText()} ${body.slice(0, 500)}`,
  ).toBeTruthy();
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${body.slice(0, 500)}; ${String(error)}`);
  }
}

export async function openGoldenSurface(
  page: Page,
  _request: unknown,
  role: 'customer' | 'contractor',
  path: string,
): Promise<{ user: DemoUser; project: DemoProject }> {
  // Each human journey owns a fresh API context. Reusing the Playwright worker's
  // long-lived keep-alive socket across slow browser journeys can race Uvicorn's
  // idle connection close and produce a false ECONNRESET on the next /auth/demo.
  // The canonical runner separately proves that the API container did not restart.
  const apiRequest = await playwrightRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { Connection: 'close' },
  });

  let user: DemoUser;
  let projects: DemoProject[];
  try {
    const ready = await apiRequest.get('/ready');
    expect(ready.ok(), `Golden API must be ready before ${role} login`).toBeTruthy();

    user = await readJson<DemoUser>(
      await apiRequest.post('/api/v1/auth/demo', { data: { role } }),
      `${role} demo login`,
    );
    projects = await readJson<DemoProject[]>(
      await apiRequest.get('/api/v1/projects', { headers: authHeaders(user) }),
      `${role} project list`,
    );
  } finally {
    await apiRequest.dispose();
  }

  const project = pickPrimaryDemoProject(projects);
  expect(project?.id, `${role} must have a seeded project`).toBeTruthy();
  if (role === 'customer') {
    await seedDemoCustomerSession(page, user.id, project.id, user.access_token);
  } else {
    await seedDemoContractorSession(page, user.id, project.id, user.access_token);
  }
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response?.status() ?? 500).toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    /Unhandled Runtime Error|Application error|Cannot read properties of|TODO|заглушка|не реализовано|coming soon/i,
  );
  expect(errors).toEqual([]);
  return { user, project };
}

export async function expectHumanAction(page: Page, pattern: RegExp): Promise<void> {
  const action = page.getByRole('button', { name: pattern }).or(page.getByRole('link', { name: pattern }));
  await expect(action.first(), `Expected human action matching ${pattern}`).toBeVisible();
}
