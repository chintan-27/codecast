import { randomUUID } from 'node:crypto';
import { _electron as electron, expect, test } from '@playwright/test';

test('Kokoro generates playable narration and reuses the on-disk cache', async () => {
  test.skip(
    !process.env.CODECAST_TEST_KOKORO,
    'Opt in after npm run setup:tts. This test uses the real local model.',
  );
  test.setTimeout(600000);
  const app = await electron.launch({
    args: [
      '.',
      ...(process.env.CODECAST_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu'] : []),
    ],
    env: {
      ...process.env,
      CODECAST_EPISODES_DIR: '/tmp/codecast-episodes-' + randomUUID(),
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 960 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    expect(await page.evaluate(() => window.codecast!.speechStatus())).toMatchObject({
      available: true,
      ready: true,
    });
    await page.getByRole('button', { name: 'Narration', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Kokoro is ready');
    await page.getByLabel('Narration voice').selectOption('af_heart');
    await page.getByRole('button', { name: 'Generate narration', exact: true }).click();
    await expect(page.locator('.speech-success')).toContainText('Narration is ready for 6 steps', {
      timeout: 480000,
    });
    await page.screenshot({ path: 'test-results/kokoro.png', fullPage: true });
    await page.getByRole('button', { name: 'Back to the lesson' }).click();
    await expect(page.getByText('Heart · Kokoro')).toBeVisible();
    await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
    await expect
      .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
      .toBeGreaterThan(0.1);
    expect(await page.locator('audio').getAttribute('src')).toMatch(/^data:audio\/wav;base64,/);
    await page.getByRole('button', { name: 'Pause lesson', exact: true }).click();
    await page.getByRole('button', { name: 'Narration', exact: true }).click();
    await page.getByRole('button', { name: 'Generate narration', exact: true }).click();
    await expect(page.locator('.speech-success')).toContainText('6 reused from cache', {
      timeout: 15000,
    });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
