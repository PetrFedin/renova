import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { openGoldenSurface } from '../../apps/mobile/e2e/golden/helpers';
import { exportPresentationClip } from '../../scripts/presentation-media.mjs';

const scenes = [
  { name: 'estimate', route: '/object?tab=estimate', text: /Смет|Объект|комнат/i, seconds: 9 },
  { name: 'budget', route: '/budget?tab=summary', text: /Бюджет|План|Факт/i, seconds: 9 },
  { name: 'execution', route: '/repair?tab=works', text: /работ|этап|ремонт/i, seconds: 9 },
];

async function assertProductScene(page: Page, text: RegExp) {
  await expect(page.locator('body')).toContainText(text);
  await expect(page.locator('body')).not.toContainText(
    /Unhandled Runtime Error|Application error|Cannot read properties of|Нет доступа|заглушка|не реализовано/i,
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
    await openGoldenSurface(page, request, role, scenes[0].route);
    await assertProductScene(page, scenes[0].text);
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
        await assertProductScene(recordedPage, scene.text);
        // Presentation pacing is intentional; no animation or fake interaction is injected.
        await recordedPage.waitForTimeout(scene.seconds * 1000);
        await assertProductScene(recordedPage, scene.text);
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
