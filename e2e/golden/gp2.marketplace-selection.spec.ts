import { test, expect } from '@playwright/test';
import { API } from '../helpers';
import { headers, registerOtpUser, trashProject } from './helpers';

test.describe('@golden @gp2 marketplace customer ↔ competing contractors', () => {
  test('two independent contractors quote → customer selects one → only winner gets project', async ({ request }) => {
    const customer = await registerOtpUser(request, 'customer', { fullName: 'Golden Marketplace Customer' });
    const e1 = await registerOtpUser(request, 'contractor', { fullName: 'Golden E1' });
    const e2 = await registerOtpUser(request, 'contractor', { fullName: 'Golden E2' });

    const activeNpd = [
      [e1, ['7700', '0000', '0001'].join('')],
      [e2, ['7700', '0000', '0003'].join('')],
    ] as const;
    for (const [contractor, inn] of activeNpd) {
      const verified = await request.post(`${API}/api/v1/fns/verify-me`, {
        headers: headers(contractor),
        data: { inn },
      });
      expect(verified.ok(), `active simulated NPD verification failed: ${verified.status()}`).toBeTruthy();
      expect((await verified.json()).is_npd).toBe(true);
    }
    const leadResponse = await request.post(`${API}/api/v1/job-leads`, {
      headers: headers(customer),
      data: {
        title: `Golden renovation ${Date.now()}`,
        address: 'Москва, ЦАО, точный адрес скрыт',
        area_sqm: 55,
        renovation_type: 'cosmetic',
        budget_hint: 2_000_000,
        description: 'Golden-path lead with two competing quotes',
      },
    });
    expect(leadResponse.ok()).toBeTruthy();
    const lead = (await leadResponse.json()) as { id: string };

    const q1Response = await request.post(`${API}/api/v1/job-leads/${lead.id}/quote`, {
      headers: headers(e1),
      data: { pre_estimate: 1_800_000, note: '8 недель' },
    });
    const q2Response = await request.post(`${API}/api/v1/job-leads/${lead.id}/quote`, {
      headers: headers(e2),
      data: { pre_estimate: 1_950_000, note: '7 недель' },
    });
    expect(q1Response.ok()).toBeTruthy();
    expect(q2Response.ok()).toBeTruthy();
    const q1 = (await q1Response.json()) as { quote_id: string };

    const ownerView = await request.get(`${API}/api/v1/job-leads?status=open`, {
      headers: headers(customer),
    });
    expect(ownerView.ok()).toBeTruthy();
    const rows = (await ownerView.json()) as Array<{ id: string; quotes?: unknown[]; quotes_count?: number }>;
    const row = rows.find((item) => item.id === lead.id);
    expect(row?.quotes_count).toBe(2);
    expect(row?.quotes).toHaveLength(2);

    const accepted = await request.post(
      `${API}/api/v1/job-leads/${lead.id}/quotes/${q1.quote_id}/accept`,
      { headers: headers(customer) },
    );
    expect(accepted.ok()).toBeTruthy();

    const converted = await request.post(`${API}/api/v1/job-leads/${lead.id}/convert`, {
      headers: headers(customer),
      data: {
        property_type: 'apartment',
        rooms: [{ name: 'Комната', length_m: 5, width_m: 4, height_m: 2.7, openings_sq_m: 2 }],
      },
    });
    expect(converted.ok(), `lead conversion failed: ${converted.status()}`).toBeTruthy();
    const projectId = ((await converted.json()) as { project_id: string }).project_id;

    try {
      const e1Projects = (await (
        await request.get(`${API}/api/v1/projects`, { headers: headers(e1) })
      ).json()) as Array<{ id: string }>;
      const e2Projects = (await (
        await request.get(`${API}/api/v1/projects`, { headers: headers(e2) })
      ).json()) as Array<{ id: string }>;
      expect(e1Projects.some((item) => item.id === projectId)).toBe(true);
      expect(e2Projects.some((item) => item.id === projectId)).toBe(false);

      const losingRead = await request.get(`${API}/api/v1/projects/${projectId}`, {
        headers: headers(e2),
      });
      expect(losingRead.status()).toBe(404);
    } finally {
      await trashProject(request, customer, projectId);
    }
  });

  test('contractor without active NPD status must not receive open leads', async ({ request }) => {
    const customer = await registerOtpUser(request, 'customer', { fullName: 'Golden NPD Customer' });
    const inactive = await registerOtpUser(request, 'contractor', { fullName: 'Golden NPD Inactive' });
    const created = await request.post(`${API}/api/v1/job-leads`, {
      headers: headers(customer),
      data: {
        title: `NPD gated lead ${Date.now()}`,
        area_sqm: 40,
        renovation_type: 'cosmetic',
        budget_hint: 1_000_000,
      },
    });
    expect(created.ok()).toBeTruthy();
    const leadId = ((await created.json()) as { id: string }).id;

    const list = await request.get(`${API}/api/v1/job-leads?status=open`, {
      headers: headers(inactive),
    });
    expect(list.ok()).toBeTruthy();
    const rows = (await list.json()) as Array<{ id: string }>;
    expect(
      rows.some((item) => item.id === leadId),
      'An unverified/inactive contractor must not see leads that require active NPD status',
    ).toBe(false);
  });
});
