import { randomUUID } from 'node:crypto';
import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { agentIdSchema } from '../../packages/agents/contract';

test('a live coding agent generates a lesson that opens in the desktop player', async () => {
  test.skip(
    !process.env.CODECAST_TEST_AGENT,
    'Opt in with CODECAST_TEST_AGENT=codex, claude, or opencode after signing in.',
  );
  test.setTimeout(300000);
  const agent = agentIdSchema.parse(process.env.CODECAST_TEST_AGENT);
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
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, path.resolve('tests/fixtures/sample'));
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Create lesson', exact: true }).click();
    await page.getByLabel('Coding agent').selectOption(agent);
    await page.getByLabel('Explanation depth').selectOption('overview');
    await page
      .getByLabel('Episode focus')
      .fill(
        'Trace checkout through quantity validation to saving an order and returning its identifier. Explain the in-memory storage limitation.',
      );
    if (process.env.CODECAST_TEST_AGENT_MODEL)
      await page.getByLabel('Model', { exact: false }).fill(process.env.CODECAST_TEST_AGENT_MODEL);
    await page.getByRole('button', { name: 'Generate walkthrough', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open walkthrough', exact: true })).toBeVisible({
      timeout: 240000,
    });
    const title = await page.locator('.generation-result h3').innerText();
    await page.screenshot({ path: `test-results/generation-${agent}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Open walkthrough', exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByTestId('active-file')).toHaveText(/^src\/(checkout|server|orders)\.ts$/);
    await expect(page.locator('.lesson-highlight').first()).toBeVisible();
    await expect(page.getByText('Reading mode · no audio', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Narration', exact: true })).toBeEnabled();
  } finally {
    await app.close();
  }
});
