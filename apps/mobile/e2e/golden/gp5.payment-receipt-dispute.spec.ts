import { test, expect } from '@playwright/test';
import { openGoldenSurface } from './helpers';

test('@golden @gp5 payment truth is understandable to payer and recipient', async ({ page, request }) => {
  await openGoldenSurface(page, request, 'customer', '/budget?tab=payments');
  await expect(page.locator('body')).toContainText(/Оплат|Счёт|Бюджет|чек/i);
  await openGoldenSurface(page, request, 'contractor', '/budget?tab=payments');
  await expect(page.locator('body')).toContainText(/Оплат|Счёт|Бюджет/i);
});
