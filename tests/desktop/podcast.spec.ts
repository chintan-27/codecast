import { randomUUID } from 'node:crypto';
import { _electron as electron, expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { flattenSteps, lessonSchema } from '../../packages/core/lesson';

test('the CodeCast repository podcast imports and plays every segment with synchronized source', async () => {
  test.skip(
    !process.env.CODECAST_TEST_EPISODE,
    'Generate an episode with npm run test:podcast:self first.',
  );
  test.setTimeout(120000);
  const filename = path.resolve(process.env.CODECAST_TEST_EPISODE!);
  const episode = lessonSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
  const steps = flattenSteps(episode);
  const app = await electron.launch({
    env: { ...process.env, CODECAST_EPISODES_DIR: '/tmp/codecast-episodes-' + randomUUID() },
    args: [
      '.',
      ...(process.env.CODECAST_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu'] : []),
    ],
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 960 });
    const errors: string[] = [];
    page.on('pageerror', (cause) => errors.push(cause.message));
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, process.cwd());
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, filename);
    await page.getByRole('button', { name: 'Import lesson', exact: true }).click();
    await expect(page.getByRole('heading', { name: episode.title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
    await expect
      .poll(() =>
        page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime),
      )
      .toBeGreaterThan(0.1);
    await page.getByRole('button', { name: 'Pause lesson', exact: true }).click();
    const pausedAt = await page
      .locator('audio')
      .evaluate((element: HTMLAudioElement) => element.currentTime);
    await page.waitForTimeout(350);
    expect(
      await page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime),
    ).toBeCloseTo(pausedAt, 1);
    if (steps.length > 1) {
      await page.getByRole('slider', { name: 'Seek lesson step' }).fill(String(steps.length - 1));
      await expect(page.locator('.narration-card h2')).toHaveText(steps.at(-1)!.title);
      await page.getByRole('button', { name: 'Previous step' }).click();
      await expect(page.locator('.narration-card h2')).toHaveText(steps.at(-2)!.title);
      await page.getByRole('slider', { name: 'Seek lesson step' }).fill('0');
    }
    await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
    for (const step of steps) {
      await expect(page.locator('.narration-card h2')).toHaveText(step.title);
      await expect(page.getByTestId('active-file')).toHaveText(step.anchor.file);
      await expect(page.getByTestId('active-range')).toHaveText(
        `Lines ${step.anchor.startLine}–${step.anchor.endLine}`,
      );
      await expect(page.locator('.lesson-highlight').first()).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator('audio')
            .evaluate(
              (element: HTMLAudioElement) =>
                !element.paused && element.currentTime > 0.05 && Number.isFinite(element.duration),
            ),
        )
        .toBe(true);
      // Exercise the actual media end event, without waiting the full episode on every test run.
      await page.locator('audio').evaluate((element: HTMLAudioElement) => {
        element.currentTime = element.duration - 0.1;
      });
    }
    await expect(page.getByText('That’s the whole journey.', { exact: true })).toBeVisible();
    await page.screenshot({
      path: path.join(path.dirname(filename), 'playback.png'),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    const reportPath = path.join(path.dirname(filename), 'verification.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          ...report,
          desktopPlaybackVerified: true,
          pauseResumeVerified: true,
          chapterSeekingVerified: true,
          automaticTransitionsVerified: steps.length,
          playbackVerifiedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await app.close();
  }
});

test('saved podcasts play every segment from recorded source without importing again', async () => {
  test.skip(
    !process.env.CODECAST_TEST_SAVED_LIBRARY,
    'Opt in with a saved episode library directory.',
  );
  test.setTimeout(300000);
  const app = await electron.launch({
    args: [
      '.',
      ...(process.env.CODECAST_HEADLESS ? ['--ozone-platform=headless', '--disable-gpu'] : []),
    ],
    env: { ...process.env, CODECAST_EPISODES_DIR: process.env.CODECAST_TEST_SAVED_LIBRARY! },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 960 });
    await expect(page.getByRole('button', { name: 'Episode library', exact: true })).toBeEnabled();
    const entries = await page.evaluate(async () => await window.codecast!.listEpisodes!());
    // Filter outside the renderer: Electron intentionally does not expose Node globals there.
    const selected = entries.filter((entry) =>
      entry.title.startsWith(process.env.CODECAST_TEST_SAVED_PREFIX ?? 'Inside CodeCast'),
    );
    expect(selected.length).toBeGreaterThan(0);
    for (const entry of selected) {
      await page.getByRole('button', { name: 'Episode library', exact: true }).click();
      await page.getByRole('button', { name: `Open episode ${entry.title}`, exact: true }).click();
      await expect(page.getByRole('heading', { name: entry.title, exact: true })).toBeVisible();
      await expect(page.locator('.preview-badge')).toContainText('RECORDED SOURCE');
      for (let index = 0; index < entry.stepCount; index++) {
        await page.locator('.step-link').nth(index).click();
        await expect(page.locator('.lesson-highlight').first()).toBeVisible();
        await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
        await expect
          .poll(() =>
            page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime),
          )
          .toBeGreaterThan(0.05);
        await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
          audio.currentTime = Math.max(0, audio.duration - 0.08);
        });
        if (index < entry.stepCount - 1) {
          await expect(page.locator('.step-link').nth(index + 1)).toHaveAttribute(
            'aria-current',
            'step',
          );
          await page.getByRole('button', { name: 'Pause lesson', exact: true }).click();
        } else await expect(page.getByText('That’s the whole journey.')).toBeVisible();
      }
    }
    await page.screenshot({ path: 'test-results/saved-podcasts.png', fullPage: true });
  } finally {
    await app.close();
  }
});
