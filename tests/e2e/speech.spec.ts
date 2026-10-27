import { expect, test } from '@playwright/test';

test('canceling speech preserves the current lesson audio and unlocks the controls', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let rejectJob: ((error: Error) => void) | null = null;
    window.codecast = {
      listAgents: async () => [],
      generationFiles: async () => [],
      generateLesson: async () => {
        throw new Error('Not used in speech tests.');
      },
      cancelLessonGeneration: async () => {},
      onGenerationProgress: () => () => {},
      openRepository: async () => null,
      readSource: async () => '',
      readAudio: async () => '',
      openLesson: async () => null,
      speechStatus: async () => ({ available: true, ready: true, message: 'Kokoro is ready.' }),
      prepareSpeech: async () => ({ available: true, ready: true, message: 'Kokoro is ready.' }),
      generateSpeech: async () =>
        new Promise((_resolve, reject) => {
          rejectJob = reject;
        }),
      cancelSpeech: async () => {
        rejectJob?.(new Error('Narration canceled.'));
      },
      readSpeechAudio: async () => '',
      onSpeechProgress: () => () => {},
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Narration', exact: true }).click();
  await page.getByRole('button', { name: 'Generate narration', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  await expect(page.locator('.speech-error')).toContainText('Narration canceled.');
  await expect(page.locator('.speech-success')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close narration settings' }).click();
  await expect(page.getByText('Local audio narration', { exact: true })).toBeVisible();
  await expect(page.locator('audio')).toHaveAttribute('src', /demo\/step-1\.mp3$/);
  await expect(page.getByRole('button', { name: 'Play lesson', exact: true })).toBeEnabled();
});

test('browser preview explains that speech generation requires the desktop app', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Narration', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Open the CodeCast desktop app');
  await expect(page.getByRole('button', { name: 'Generate narration' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('speech settings apply generated clip durations and selected voice through the bridge', async ({
  page,
}) => {
  // Mock only the native boundary; actual Kokoro is exercised by the opt-in desktop test.
  await page.addInitScript(() => {
    window.codecast = {
      listAgents: async () => [],
      generationFiles: async () => [],
      generateLesson: async () => {
        throw new Error('Not used in speech tests.');
      },
      cancelLessonGeneration: async () => {},
      onGenerationProgress: () => () => {},
      openRepository: async () => null,
      readSource: async () => '',
      readAudio: async () => '',
      openLesson: async () => null,
      speechStatus: async () => ({ available: true, ready: true, message: 'Kokoro is ready.' }),
      prepareSpeech: async () => ({ available: true, ready: true, message: 'Kokoro is ready.' }),
      generateSpeech: async (request) =>
        request.steps.map((step) => ({
          stepId: step.id,
          cacheKey: 'a'.repeat(64),
          durationSeconds: 10,
          cached: true,
        })),
      cancelSpeech: async () => {},
      readSpeechAudio: async () => '/demo/step-1.mp3',
      onSpeechProgress: () => () => {},
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Narration', exact: true }).click();
  await page.getByLabel('Narration voice').selectOption('am_michael');
  await page.getByRole('button', { name: 'Generate narration', exact: true }).click();
  await expect(page.locator('.speech-success')).toContainText('6 reused from cache');
  await page.getByRole('button', { name: 'Back to the lesson' }).click();
  await expect(page.getByText('Michael · Kokoro')).toBeVisible();
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Narration', exact: true }).click();
  await expect(page.getByLabel('Narration voice')).toHaveValue('am_michael');
});
