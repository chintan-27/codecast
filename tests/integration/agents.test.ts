import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LessonGenerationService } from '../../packages/agents/service';
import { RepositoryAccess } from '../../packages/repository/access';
import { collectContext, finalizeLesson } from '../../packages/agents/context';
import {
  generationRequestSchema,
  type AgentId,
  type GenerationRequest,
} from '../../packages/agents/contract';
import draft from '../fixtures/agent-draft.json';
import { flattenSteps, validateLessonSources } from '../../packages/core/lesson';
import { parseDocument } from '../../packages/agents/adapters';

const temporary: string[] = [];
async function fixture(behavior = 'success') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codecast-agent-test-'));
  temporary.push(root);
  const repository = path.join(root, 'project');
  await cp('tests/fixtures/sample', repository, { recursive: true });
  const binaries = Object.fromEntries(
    ['codex', 'claude', 'opencode'].map((agent) => [
      agent,
      {
        file: process.execPath,
        prefixArgs: [
          path.resolve('tests/fixtures/fake-agent.mjs'),
          agent,
          behavior,
          path.join(repository, 'src/checkout.ts'),
        ],
      },
    ]),
  );
  return {
    root,
    repo: await RepositoryAccess.open(repository),
    service: new LessonGenerationService({ dataDirectory: path.join(root, 'data'), binaries }),
  };
}
const request = (agent: AgentId = 'codex'): GenerationRequest => ({
  agent,
  objective: 'Trace checkout through quantity validation and storage.',
  depth: 'overview',
  model: '',
  files: ['src/checkout.ts', 'src/server.ts', 'src/orders.ts'],
});
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('agent adapters and lesson generation', () => {
  it('stops OpenCode immediately on a terminal provider event without forwarding its private diagnostics', async () => {
    const { repo, service } = await fixture('stream-error');
    await expect(service.generate(repo, request('opencode'), () => {})).rejects.toThrow(
      'OpenCode reported a provider error',
    );
  });
  it.each(['codex', 'claude', 'opencode'] as const)(
    'normalizes %s output, fingerprints source, and saves outside the repository',
    async (agent) => {
      const { root, repo, service } = await fixture();
      const before = await readFile(path.join(repo.directory, 'src/checkout.ts'), 'utf8');
      const result = await service.generate(repo, request(agent), () => {});
      expect(result.agent).toBe(agent);
      expect(flattenSteps(result.lesson)).toHaveLength(4);
      expect(result.lesson.repositoryRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
      await validateLessonSources(result.lesson, repo.readSource.bind(repo));
      expect(await readFile(path.join(repo.directory, 'src/checkout.ts'), 'utf8')).toBe(before);
      const saved = await readdir(path.join(root, 'data/lessons'));
      expect(saved).toEqual([`${result.lesson.lessonId}.json`]);
      expect(JSON.parse(await readFile(path.join(root, 'data/lessons', saved[0]), 'utf8'))).toEqual(
        result.lesson,
      );
    },
  );

  it('detects each CLI without invoking a model', async () => {
    const { service } = await fixture();
    expect(await service.detect()).toEqual(
      expect.arrayContaining(
        ['codex', 'claude', 'opencode'].map((id) =>
          expect.objectContaining({ id, available: true, version: '1.2.3' }),
        ),
      ),
    );
  });

  it('rejects files that were excluded, oversized, or exceed the context budget', async () => {
    const { repo } = await fixture();
    await writeFile(path.join(repo.directory, '.env'), 'secret');
    await writeFile(path.join(repo.directory, '.gitignore'), 'ignored.ts\n');
    await writeFile(path.join(repo.directory, 'ignored.ts'), 'ignored');
    const signal = new AbortController().signal;
    for (const file of ['.env', 'ignored.ts', '../outside.ts'])
      await expect(collectContext(repo, [file], signal)).rejects.toThrow();
    await writeFile(path.join(repo.directory, 'large.ts'), 'x'.repeat(65537));
    await expect(collectContext(repo, ['large.ts'], signal)).rejects.toThrow('64 KB');
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
    await Promise.all(
      files.map((file) => writeFile(path.join(repo.directory, file), 'x'.repeat(60000))),
    );
    await expect(collectContext(repo, files, signal)).rejects.toThrow('200 KB');
  });

  it('rejects invented files, invalid ranges, and source changes during generation', async () => {
    const { repo } = await fixture();
    const context = await collectContext(repo, request().files, new AbortController().signal);
    const invalid = structuredClone(draft);
    invalid.scenes[0].steps[0].endLine = 999;
    await expect(finalizeLesson(invalid, context, repo)).rejects.toThrow('invalid source range');
    const foreign = await fixture('foreign');
    await expect(foreign.service.generate(foreign.repo, request(), () => {})).rejects.toThrow(
      'outside the selected context',
    );
    const stale = await fixture('stale');
    await expect(stale.service.generate(stale.repo, request(), () => {})).rejects.toThrow(
      'Source changed',
    );
    await expect(readdir(path.join(stale.root, 'data/lessons'))).rejects.toThrow();
  });

  it('cancels the child process, prevents concurrent runs, and leaves no lesson artifact', async () => {
    const { root, repo, service } = await fixture('wait');
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = service.generate(repo, request(), (event) => {
      if (event.message.includes('planning')) started();
    });
    const rejected = expect(pending).rejects.toThrow('canceled');
    await ready;
    await expect(service.generate(repo, request(), () => {})).rejects.toThrow('Another lesson');
    service.cancel();
    await rejected;
    await expect(readdir(path.join(root, 'data/lessons'))).rejects.toThrow();
    const again = service.generate(repo, request(), (event) => {
      if (event.message.includes('planning')) service.cancel();
    });
    await expect(again).rejects.toThrow('canceled');
  });

  it('reports authentication failures without forwarding private diagnostics', async () => {
    const { repo, service } = await fixture('auth');
    await expect(service.generate(repo, request(), () => {})).rejects.toThrow('Sign in');
    try {
      await service.generate(repo, request(), () => {});
    } catch (cause) {
      expect(String(cause)).not.toContain('private-secret');
    }
  });

  it('validates request paths and model IDs and parses only complete JSON documents', () => {
    expect(
      generationRequestSchema.safeParse({ ...request(), files: ['../escape.ts'] }).success,
    ).toBe(false);
    expect(
      generationRequestSchema.safeParse({ ...request(), files: ['src/a.ts', 'src/a.ts'] }).success,
    ).toBe(false);
    expect(generationRequestSchema.safeParse({ ...request(), model: '--unsafe' }).success).toBe(
      false,
    );
    expect(parseDocument('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(() => parseDocument('some prose {"ok":true}')).toThrow('valid lesson JSON');
  });
});
