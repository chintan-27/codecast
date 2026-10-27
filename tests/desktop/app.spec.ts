import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

test('packaged desktop serves workers/audio and reads only the selected repository', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'codecast-desktop-'));
  await cp('tests/fixtures/sample', fixture, { recursive: true });
  const app = await electron.launch({
    args: [
      '.',
      ...(process.env.CODECAST_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu'] : []),
    ],
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 960 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'Follow the checkout.' })).toBeVisible();
    expect(new URL(page.url()).protocol).toBe('codecast:');
    expect(await page.evaluate(() => typeof window.codecast?.readSource)).toBe('function');
    expect(
      await page.evaluate(() => typeof (window as Window & { require?: unknown }).require),
    ).toBe('undefined');
    await expect(page.locator('.lesson-highlight').first()).toBeVisible();
    await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
    await expect
      .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
      .toBeGreaterThan(0.1);
    await page.getByRole('button', { name: 'Pause lesson', exact: true }).click();

    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, fixture);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Meet your codebase.' })).toBeVisible();
    const source = await page.evaluate(() => window.codecast!.readSource('src/server.ts'));
    expect(source).toContain('createOrder');
    const blocked = await page.evaluate(async () => {
      try {
        await window.codecast!.readSource('../outside.ts');
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked).toBe(true);

    await app.evaluate(
      ({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      },
      path.join(fixture, 'codecast.lesson.json'),
    );
    await page.getByRole('button', { name: 'Import lesson', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Follow the checkout.' })).toBeVisible();
    await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
    await expect
      .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
      .toBeGreaterThan(0.1);
    await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Pause lesson', exact: true }).click();
    const sourcePath = path.join(fixture, 'src/checkout.ts');
    await writeFile(
      sourcePath,
      (await readFile(sourcePath, 'utf8')) + '\n// Changed after import\n',
    );
    await page.getByRole('button', { name: /A small, complete journey/ }).click();
    await expect(page.locator('.error-banner')).toContainText('Source changed');
    await expect(page.locator('.lesson-highlight')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
