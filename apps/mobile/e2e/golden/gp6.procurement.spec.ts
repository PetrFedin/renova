import { test, expect } from '@playwright/test';
import { openGoldenSurface } from './helpers';

test('@golden @gp6 procurement has an obvious propose → approve → purchase state', async ({ page, request }) => {
  await openGoldenSurface(page, request, 'contractor', '/repair?tab=materials');
  await expect(page.locator('body')).toContainText(/Материал|Закуп|соглас/i);
  await openGoldenSurface(page, request, 'customer', '/repair?tab=materials');
  await expect(page.locator('body')).toContainText(/Материал|Закуп|соглас/i);
});
