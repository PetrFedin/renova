import { expect, test } from '@playwright/test';

test.describe('Public Renova platform brief', () => {
  test.skip(
    () => !process.env.RENOVA_WEB_E2E && !process.env.RENOVA_E2E_REQUIRE_SERVICES,
    'Start Expo web or use the canonical service-backed E2E runner',
  );

  test('opens directly, explains the product and renders the canonical QR', async ({ page }) => {
    await page.goto('/platform');

    await expect(page).toHaveURL(/\/platform(?:\?.*)?$/);
    await expect(page.getByRole('heading', { name: 'Renova объединяет ремонт в один управляемый процесс' })).toBeVisible();
    await expect(page.getByText('Сквозной процесс', { exact: true })).toBeVisible();
    await expect(page.getByText('Что внутри платформы', { exact: true })).toBeVisible();
    await expect(page.getByText('Статус продукта — без маркетингового тумана', { exact: true })).toBeVisible();
    await expect(page.getByText('BLOCKED_FOR_BROAD_PRODUCTION', { exact: false })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Открыть платформу' })).toBeVisible();

    const qr = page.getByRole('img', { name: 'QR-код' });
    await expect(qr).toBeVisible();

    await expect(page.getByText(/\/platform/).first()).toBeVisible();
  });
});
