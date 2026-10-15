import { test, expect } from '@playwright/test';
import { API } from '../helpers';
import { createFreshProject, headers, money, registerOtpUser, trashProject } from './helpers';

test.describe('@golden @gp1 customer project → estimate → budget', () => {
  test('OTP registration → 3 rooms → estimate total = budget → next action is contractor search', async ({ request }) => {
    const customer = await registerOtpUser(request, 'customer');
    const outsider = await registerOtpUser(request, 'customer', { fullName: 'Golden Outsider' });
    const project = (await createFreshProject(request, customer)) as {
      id: string;
      rooms: unknown[];
      estimate_lines: Array<{ quantity_planned: number; unit_price: number; total?: number }>;
      budget_planned: number;
    };

    try {
      expect(project.rooms).toHaveLength(3);
      expect(project.estimate_lines.length).toBeGreaterThan(0);
      const estimateTotal = money(
        project.estimate_lines.reduce(
          (sum, line) => sum + Number(line.total ?? Number(line.quantity_planned) * Number(line.unit_price)),
          0,
        ),
      );
      expect(money(project.budget_planned), 'Project plan must equal the exact estimate projection').toBe(estimateTotal);

      const dashboardResponse = await request.get(`${API}/api/v1/projects/${project.id}/dashboard`, {
        headers: headers(customer),
      });
      expect(dashboardResponse.ok()).toBeTruthy();
      const dashboard = (await dashboardResponse.json()) as {
        progress_percent: number;
        next_action_type?: string;
        next_action_title?: string;
      };
      expect(money(dashboard.progress_percent)).toBe(0);
      expect(
        dashboard.next_action_type,
        `A new estimated project must route the customer to finding a contractor, got: ${dashboard.next_action_title}`,
      ).toBe('find_contractor');

      const privacyRead = await request.get(`${API}/api/v1/projects/${project.id}`, {
        headers: headers(outsider),
      });
      expect(privacyRead.status(), 'Unrelated users must not learn whether the project exists').toBe(404);
    } finally {
      await trashProject(request, customer, project.id);
    }
  });

  test('estimate cannot be created from a project with zero rooms', async ({ request }) => {
    const customer = await registerOtpUser(request, 'customer', { fullName: 'Golden Empty Rooms' });
    const response = await request.post(`${API}/api/v1/projects`, {
      headers: headers(customer),
      data: {
        name: `Golden no rooms ${Date.now()}`,
        address: 'E2E Golden Path',
        renovation_type: 'cosmetic',
        property_type: 'apartment',
        total_area_sqm: 0,
        rooms: [],
      },
    });
    expect(response.status()).toBe(422);
  });
});
