import { _electron as electron, expect, test } from '@playwright/test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('saved episode restores source and audio across desktop restarts without the original folder', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codecast-restart-'));
  const fixture = path.join(root, 'project');
  await cp('tests/fixtures/sample', fixture, { recursive: true });
  const options = {
    args: [
      '.',
      ...(process.env.CODECAST_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu'] : []),
    ],
    env: { ...process.env, CODECAST_EPISODES_DIR: path.join(root, 'episodes') },
  };
  let app = await electron.launch(options);
  try {
    let page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Follow the checkout.' })).toBeVisible();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, fixture);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await app.evaluate(
      ({ dialog }, filename) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
      },
      path.join(fixture, 'codecast.lesson.json'),
    );
    await page.getByRole('button', { name: 'Import lesson', exact: true }).click();
    await expect(page.locator('.preview-badge')).toContainText('RECORDED SOURCE');
    await app.close();
    await rm(fixture, { recursive: true });
    app = await electron.launch(options);
    page = await app.firstWindow();
    await expect(page.locator('.preview-badge')).toContainText('RECORDED SOURCE');
    await expect(page.getByRole('heading', { name: 'Follow the checkout.' })).toBeVisible();
    await expect(page.locator('.lesson-highlight').first()).toBeVisible();
    await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
    await expect
      .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
      .toBeGreaterThan(0.1);
    await page.getByRole('button', { name: 'Episode library', exact: true }).click();
    await page.getByRole('button', { name: 'Open episode Follow the checkout.' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import lesson', exact: true })).toBeDisabled();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
