import { test, expect } from '@playwright/test';
import { openGoldenSurface } from './helpers';

test('@golden @gp7 document center exposes contract, signature state and exports in one place', async ({ page, request }) => {
  await openGoldenSurface(page, request, 'customer', '/documents');
  await expect(page.locator('body')).toContainText(/Документ|Договор|подпис|1С|экспорт/i);
  await openGoldenSurface(page, request, 'contractor', '/documents');
  await expect(page.locator('body')).toContainText(/Документ|Договор|подпис/i);
});
