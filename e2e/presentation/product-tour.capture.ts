import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { API, authHeaders, openGoldenSurface } from '../../apps/mobile/e2e/golden/helpers';
import { exportPresentationClip } from '../../scripts/presentation-media.mjs';

async function assertProductScene(page: Page, landmark: string) {
  const content = page.getByText(landmark, { exact: true }).first();
  await expect(content, 'Scene must display loaded product data, not its navigation shell').toBeVisible();
  await content.scrollIntoViewIfNeeded();
  await expect(page.locator('body')).not.toContainText(
    /Unhandled Runtime Error|Application error|Cannot read properties of|Нет доступа|заглушка|не реализовано|Не удалось (загрузить|проверить зависимости)|Данные не загружены|Загружаем бюджет|Загрузка объекта|Создайте первый объект/i,
  );
  await page.evaluate(() => document.fonts.ready);
}

for (const role of ['customer', 'contractor'] as const) {
  test(`presentation tour for ${role}`, async ({ browser, page, request, baseURL }, info) => {
    const sha = process.env.RENOVA_CAPTURE_SHA || '';
    expect(sha, 'Capture must identify the evaluated source commit').toMatch(/^[a-f0-9]{40}$/);
    expect(new URL(baseURL!).hostname, 'Presentation uses the isolated local runtime').toBe('127.0.0.1');

    // Authenticate with existing canonical demo fixtures outside the recorded context.
    // Storage state stays in memory; it is never attached, logged or uploaded.
    const { user, project } = await openGoldenSurface(page, request, role, '/object?tab=estimate');
    const detailResponse = await request.get(`${API}/api/v1/projects/${project.id}`, { headers: authHeaders(user) });
    expect(detailResponse.ok(), 'Capture requires authenticated project detail').toBeTruthy();
    const detail = await detailResponse.json() as { estimate_lines?: unknown[]; stages?: { id: string; name: string; status: string }[] };
    expect(detail.estimate_lines?.length, 'Seeded estimate must have actual lines').toBeGreaterThan(0);
    const stage = detail.stages?.find((item) => item.status !== 'done' && item.name && item.id);
    expect(stage, 'Seeded execution must have an actual unfinished stage').toBeTruthy();
    const scenes = [
      { name: 'estimate', route: '/object?tab=estimate', landmark: role === 'customer' ? 'Итого по смете' : 'Смета проекта', seconds: 9 },
      { name: 'budget', route: '/budget?tab=summary', landmark: 'Состояние бюджета', seconds: 9 },
      { name: 'execution', route: `/repair?tab=works&filter=${encodeURIComponent(`stage:${stage!.id}`)}`, landmark: stage!.name, seconds: 9 },
    ];
    await assertProductScene(page, scenes[0].landmark);
    const viewport = info.project.use.viewport!;
    const output = path.resolve('presentation-media', sha, `${role}-${info.project.name}`);
    await mkdir(output, { recursive: true });
    const context = await browser.newContext({
      baseURL, viewport, storageState: await page.context().storageState(),
      recordVideo: { dir: info.outputPath('raw-video'), size: viewport },
    });
    const recordedPage = await context.newPage();
    const video = recordedPage.video();
    const errors: string[] = [];
    recordedPage.on('pageerror', (error) => errors.push(error.message));
    const screenshots: string[] = [];
    try {
      for (const scene of scenes) {
        const response = await recordedPage.goto(scene.route, { waitUntil: 'domcontentloaded' });
        expect(response?.status() ?? 500).toBeLessThan(400);
        await assertProductScene(recordedPage, scene.landmark);
        // Presentation pacing is intentional; no animation or fake interaction is injected.
        await recordedPage.waitForTimeout(scene.seconds * 1000);
        await assertProductScene(recordedPage, scene.landmark);
        const filename = `${scene.name}.png`;
        await recordedPage.screenshot({ path: path.join(output, filename), animations: 'disabled' });
        screenshots.push(filename);
      }
      expect(errors, 'Captured product must not crash').toEqual([]);
    } finally {
      await context.close();
    }
    expect(video, 'A real browser video is required').toBeTruthy();
    const clipName = 'product-tour-25s.mp4';
    const clip = exportPresentationClip(await video!.path(), path.join(output, clipName));
    expect(clip.width).toBe(viewport.width);
    expect(clip.height).toBe(viewport.height);
    const assets = await Promise.all([...screenshots, clipName].map(async (name) => {
      const bytes = await readFile(path.join(output, name));
      return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }));
    // Only write the admission manifest after all assertions and encoding checks pass.
    await writeFile(path.join(output, 'manifest.json'), JSON.stringify({
      sourceSha: sha, role, viewport, clip, assets,
      recordedAt: new Date().toISOString(),
      runUrl: process.env.RENOVA_CAPTURE_RUN_URL || null,
      environment: 'isolated-canonical-local-runtime', data: 'seeded-demo',
      scenes: scenes.map(({ name, route }) => ({ name, route })),
      visualReview: 'PENDING', publication: 'NOT_PUBLISHED',
      limitation: 'Rendered screen tour; does not prove every business action or production behavior.',
    }, null, 2) + '\n');
  });
}
