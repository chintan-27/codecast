import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

test('supports explicitly labeled reading mode for a lesson without audio', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Choose repository folder')
    .setInputFiles(path.resolve('tests/fixtures/sample'));
  const lesson = JSON.parse(await readFile('tests/fixtures/sample/codecast.lesson.json', 'utf8'));
  lesson.scenes = [lesson.scenes[0]];
  lesson.scenes[0].steps = [lesson.scenes[0].steps[0]];
  delete lesson.scenes[0].steps[0].audio;
  lesson.scenes[0].steps[0].durationSeconds = 0.5;
  await page.getByLabel('Choose lesson JSON').setInputFiles({
    name: 'reading.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(lesson)),
  });
  await expect(page.getByText('Reading mode · no audio')).toBeVisible();
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await expect(page.getByText('That’s the whole journey.')).toBeVisible();
  await expect(page.locator('audio')).not.toHaveAttribute('src');
  await page.getByRole('button', { name: 'Replay lesson' }).click();
  await expect(page.getByText('That’s the whole journey.')).toBeHidden();
  await expect(page.getByText('That’s the whole journey.')).toBeVisible();
});

test('reports missing audio instead of silently continuing', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Choose repository folder')
    .setInputFiles(path.resolve('tests/fixtures/sample'));
  const lesson = JSON.parse(await readFile('tests/fixtures/sample/codecast.lesson.json', 'utf8'));
  lesson.scenes[0].steps[0].audio = 'audio/missing.mp3';
  await page.getByLabel('Choose lesson JSON').setInputFiles({
    name: 'missing-audio.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(lesson)),
  });
  await expect(page.locator('.error-banner')).toContainText('File not found: audio/missing.mp3');
  await expect(page.getByRole('button', { name: 'Play lesson', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pause lesson', exact: true })).toHaveCount(0);
});

test('plays real narration, pauses, navigates across files, and seeks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Follow the checkout.' })).toBeVisible();
  await expect(page.getByTestId('active-file')).toHaveText('src/checkout.ts');
  await expect(page.getByTestId('active-range')).toHaveText('Lines 8–14');
  await expect(page.locator('.lesson-highlight').first()).toBeVisible();
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Pause lesson', exact: true }).click();
  const pausedAt = await page
    .locator('audio')
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
  await page.waitForTimeout(350);
  expect(
    await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime),
  ).toBeCloseTo(pausedAt, 1);
  await page.getByRole('button', { name: /Trust the contract/ }).click();
  await expect(page.getByTestId('active-file')).toHaveText('src/server.ts');
  await expect(page.getByTestId('active-range')).toHaveText('Lines 8–14');
  await page.getByRole('slider', { name: 'Seek lesson step' }).fill('4');
  await expect(page.getByTestId('active-file')).toHaveText('src/orders.ts');
  await expect(page.getByTestId('active-range')).toHaveText('Lines 12–20');
  await page.getByRole('button', { name: 'Previous step' }).click();
  await expect(page.getByTestId('active-file')).toHaveText('src/server.ts');
  expect(errors).toEqual([]);
});

test('advances after audio ends and replays after the recap', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Create a stable record/ }).click();
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.duration))
    .toBeGreaterThan(1);
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = audio.duration - 0.15;
  });
  await expect(page.getByTestId('active-file')).toHaveText('src/checkout.ts');
  await expect(page.getByRole('heading', { name: 'Put the flow back together' })).toBeVisible();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.05);
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = audio.duration - 0.15;
  });
  await expect(page.getByText('That’s the whole journey.')).toBeVisible();
  await page.getByRole('button', { name: 'Replay lesson' }).click();
  await expect(page.getByRole('heading', { name: 'A small, complete journey' })).toBeVisible();
});

test('opens a local folder and imports a lesson, rejecting changed source', async ({ page }) => {
  await page.goto('/');
  const fixture = path.resolve('tests/fixtures/sample');
  await page.getByLabel('Choose repository folder').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Meet your codebase.' })).toBeVisible();
  await page.getByRole('button', { name: 'src/server.ts', exact: true }).click();
  await expect(page.getByTestId('active-file')).toHaveText('src/server.ts');
  await page
    .getByLabel('Choose lesson JSON')
    .setInputFiles(path.join(fixture, 'codecast.lesson.json'));
  await expect(page.getByRole('heading', { name: 'Follow the checkout.' })).toBeVisible();
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Pause lesson', exact: true }).click();
  const changed = JSON.parse(await readFile(path.join(fixture, 'codecast.lesson.json'), 'utf8'));
  changed.scenes[0].steps[0].anchor.sourceHash = '0'.repeat(64);
  await page.getByLabel('Choose lesson JSON').setInputFiles({
    name: 'stale.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(changed)),
  });
  await expect(page.locator('.error-banner')).toContainText('Source changed');
  await expect(page.getByRole('heading', { name: 'Follow the checkout.' })).toBeVisible();
});

test('allows browsing without highlights and restores the active step on play', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Files/ }).click();
  await page.getByRole('button', { name: 'src/orders.ts', exact: true }).click();
  await expect(page.getByTestId('active-file')).toHaveText('src/orders.ts');
  await expect(page.getByTestId('active-range')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await expect(page.getByTestId('active-file')).toHaveText('src/checkout.ts');
  await expect(page.getByTestId('active-range')).toHaveText('Lines 8–14');
});
