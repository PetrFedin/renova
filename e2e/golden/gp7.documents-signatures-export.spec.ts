import { test, expect } from '@playwright/test';
import { API, authHeaders, cleanupE2eGateProject, prepareContractGateScenario } from '../helpers';

test.describe('@golden @gp7 contract → signatures → immutable version → export', () => {
  test('both parties sign exact contract; signed content locks; repeated 1C read is side-effect free', async ({ request }) => {
    const s = await prepareContractGateScenario(request);
    const hC = authHeaders(s.customer);
    const hE = authHeaders(s.contractor);
    try {
      for (const h of [hC, hE]) {
        const sign = await request.post(
          `${API}/api/v1/projects/${s.projectId}/documents/${s.documentId}/sign`,
          { headers: h, data: { provider: 'in_app' } },
        );
        expect(sign.ok()).toBeTruthy();
      }

      const mutateSigned = await request.post(
        `${API}/api/v1/projects/${s.projectId}/documents/${s.documentId}/versions`,
        { headers: hE, data: { notes: 'Нельзя тихо заменить текст после подписи' } },
      );
      expect(mutateSigned.status()).toBe(409);

      const before = await request.get(`${API}/api/v1/projects/${s.projectId}/documents`, { headers: hC });
      expect(before.ok()).toBeTruthy();
      const beforeBody = await before.json();
      const beforeExports = beforeBody.items.filter((d: any) => String(d.href ?? '').includes('/export/1c-payments.csv')).length;

      const first = await request.get(`${API}/api/v1/projects/${s.projectId}/export/1c-payments.csv`, { headers: hC });
      const second = await request.get(`${API}/api/v1/projects/${s.projectId}/export/1c-payments.csv`, { headers: hC });
      expect(first.ok()).toBeTruthy();
      expect(second.ok()).toBeTruthy();

      const afterBody = await (
        await request.get(`${API}/api/v1/projects/${s.projectId}/documents`, { headers: hC })
      ).json();
      const afterExports = afterBody.items.filter((d: any) => String(d.href ?? '').includes('/export/1c-payments.csv')).length;
      expect(
        afterExports - beforeExports,
        'Repeated GET export must not create duplicate audit documents; reads should be safe to retry',
      ).toBe(1);
    } finally {
      await cleanupE2eGateProject(request, s.customer, s.projectId);
    }
  });
});
