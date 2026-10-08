import { test, expect } from '@playwright/test';
import { openGoldenSurface } from './helpers';

test('@golden @gp8 chat and inbox are distinct but connected attention surfaces', async ({ page, request }) => {
  await openGoldenSurface(page, request, 'customer', '/chat');
  await expect(page.locator('body')).toContainText(/Сообщ|чат|обсуж/i);
  await page.goto('/inbox', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toContainText(/Входящ|задач|уведом|действ/i);
  await openGoldenSurface(page, request, 'contractor', '/inbox');
  await expect(page.locator('body')).toContainText(/Входящ|задач|уведом|действ/i);
});
