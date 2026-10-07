import { test, expect } from '@playwright/test';
import { openGoldenSurface } from './helpers';

test('@golden @gp3 contractor sees one coherent execution surface, customer sees progress', async ({ page, request }) => {
  await openGoldenSurface(page, request, 'contractor', '/repair?tab=works');
  await expect(page.locator('body')).toContainText(/работ|этап|ремонт/i);
  await expect(page.locator('body')).not.toContainText(/Нет доступа|403/i);
  await openGoldenSurface(page, request, 'customer', '/repair?tab=works');
  await expect(page.locator('body')).toContainText(/работ|этап|прогресс|ремонт/i);
});
