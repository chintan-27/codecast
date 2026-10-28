import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { lessonSchema } from '../../packages/core/lesson';
import type { AgentId } from '../../packages/agents/contract';

async function mockGeneration(page: Page, behavior: 'success' | 'wait' = 'success') {
  const sources = Object.fromEntries(
    await Promise.all(
      ['checkout', 'server', 'orders'].map(async (name) => [
        `src/${name}.ts`,
        await readFile(`tests/fixtures/sample/src/${name}.ts`, 'utf8'),
      ]),
    ),
  );
  const lesson = lessonSchema.parse(
    JSON.parse(await readFile('tests/fixtures/sample/codecast.lesson.json', 'utf8')),
  );
  for (const scene of lesson.scenes) for (const step of scene.steps) delete step.audio;
  await page.addInitScript(
    ({ sources, lesson, behavior }) => {
      let rejectJob: ((error: Error) => void) | null = null;
      window.codecast = {
        openRepository: async () => ({
          name: 'sample',
          files: Object.keys(sources),
          truncated: false,
        }),
        readSource: async (file) => sources[file],
        readAudio: async () => '',
        openLesson: async () => null,
        listAgents: async () =>
          ['codex', 'claude', 'opencode'].map((id) => ({
            id: id as AgentId,
            available: true,
            version: '1.2.3',
            message: 'Installed',
          })),
        generationFiles: async () => Object.keys(sources),
        generateLesson: async (request) => {
          (window as Window & { lastAgentRequest?: unknown }).lastAgentRequest = request;
          if (behavior === 'wait')
            return new Promise((_resolve, reject) => {
              rejectJob = reject;
            });
          return {
            lesson: { ...lesson, title: `${request.agent} checkout walkthrough` },
            agent: request.agent,
            context: { files: 3, bytes: 1500, revision: 'sample-v1' },
          };
        },
        cancelLessonGeneration: async () => {
          rejectJob?.(new Error('Lesson generation canceled.'));
        },
        onGenerationProgress: () => () => {},
        speechStatus: async () => ({
          available: false,
          ready: false,
          message: 'Install speech runtime',
        }),
        prepareSpeech: async () => ({
          available: false,
          ready: false,
          message: 'Install speech runtime',
        }),
        generateSpeech: async () => [],
        cancelSpeech: async () => {},
        readSpeechAudio: async () => '',
        onSpeechProgress: () => () => {},
      };
    },
    { sources, lesson, behavior },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await page.getByRole('button', { name: 'Create lesson', exact: true }).click();
}

for (const agent of ['codex', 'claude', 'opencode'] as const) {
  test(`reviews and loads a ${agent} lesson with verified source highlights`, async ({ page }) => {
    await mockGeneration(page);
    await page.getByLabel('Coding agent').selectOption(agent);
    await page.getByLabel('Explanation depth').selectOption('overview');
    await page
      .getByLabel('Episode focus')
      .fill('Trace checkout through quantity validation and storage.');
    await page.getByLabel('Model', { exact: false }).fill('custom/model-v1');
    await page.getByRole('button', { name: 'Generate walkthrough', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Lesson validated against 3 source files');
    await expect(page.getByRole('heading', { name: 'Meet your codebase.' })).toBeVisible();
    const request = await page.evaluate(
      () => (window as Window & { lastAgentRequest?: unknown }).lastAgentRequest,
    );
    expect(request).toMatchObject({ agent, depth: 'overview', model: 'custom/model-v1' });
    await page.getByRole('button', { name: 'Open walkthrough', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: `${agent} checkout walkthrough` }),
    ).toBeVisible();
    await expect(page.getByTestId('active-file')).toHaveText('src/checkout.ts');
    await expect(page.getByTestId('active-range')).toHaveText('Lines 8–14');
    await expect(page.getByText('Reading mode · no audio', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Narration', exact: true })).toBeEnabled();
  });
}

test('canceling generation preserves the current project and allows retry', async ({ page }) => {
  await mockGeneration(page, 'wait');
  await page
    .getByLabel('Episode focus')
    .fill('Trace checkout through quantity validation and storage.');
  await page.getByRole('button', { name: 'Generate walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel lesson generation' }).click();
  await expect(page.locator('.speech-error')).toContainText('canceled');
  await expect(
    page.getByRole('button', { name: 'Generate walkthrough', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Close lesson generation' }).click();
  await expect(page.getByRole('heading', { name: 'Meet your codebase.' })).toBeVisible();
});

test('explains desktop generation when a folder is selected in the browser preview', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Choose repository folder').setInputFiles('tests/fixtures/sample');
  await page.getByRole('button', { name: 'Create lesson', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Open the CodeCast desktop app');
});
