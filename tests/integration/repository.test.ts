import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RepositoryAccess } from '../../packages/repository/access';

const temporary: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codecast-test-'));
  temporary.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/index.ts'), 'export const answer = 42;');
  return root;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('read-only repository access', () => {
  it('applies nested ignore patterns relative to their directory and allows negation', async () => {
    const root = await fixture();
    await writeFile(path.join(root, '.gitignore'), '*.tmp\n');
    await writeFile(path.join(root, 'src/.gitignore'), '*.log\n!important.tmp\n');
    await mkdir(path.join(root, 'src/nested'));
    await writeFile(path.join(root, 'src/nested/debug.log'), 'ignored at any depth');
    await writeFile(path.join(root, 'src/important.tmp'), 'explicitly included');
    const repo = await RepositoryAccess.open(root);
    expect((await repo.summary()).files).toEqual([
      '.gitignore',
      'src/.gitignore',
      'src/important.tmp',
      'src/index.ts',
    ]);
  });

  it('reads regular source and respects ignore rules while listing files', async () => {
    const root = await fixture();
    await writeFile(path.join(root, '.gitignore'), 'ignored.txt\n');
    await writeFile(path.join(root, 'ignored.txt'), 'not relevant');
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'node_modules/dependency.js'), 'excluded');
    await writeFile(path.join(root, '.env'), 'DO_NOT_READ=secret');
    const repo = await RepositoryAccess.open(root);
    expect((await repo.summary()).files).toEqual(['.gitignore', 'src/index.ts']);
    expect(await repo.readSource('src/index.ts')).toBe('export const answer = 42;');
    await expect(repo.readSource('.env')).rejects.toThrow('not allowed');
  });

  it('blocks traversal, absolute paths, and symlinks outside the approved root', async () => {
    const root = await fixture();
    const outside = await fixture();
    await symlink(path.join(outside, 'src/index.ts'), path.join(root, 'escape.ts'));
    await symlink(path.join(outside, 'src'), path.join(root, 'escape-dir'));
    const repo = await RepositoryAccess.open(root);
    for (const file of ['../outside', '/etc/passwd', 'escape.ts', 'escape-dir/index.ts']) {
      await expect(repo.readSource(file)).rejects.toThrow();
    }
    expect((await repo.summary()).files).toEqual(['src/index.ts']);
  });

  it('blocks symlinks to secrets inside the approved root', async () => {
    const root = await fixture();
    await writeFile(path.join(root, '.env'), 'secret');
    await symlink(path.join(root, '.env'), path.join(root, 'safe-name.ts'));
    const repo = await RepositoryAccess.open(root);
    await expect(repo.readSource('safe-name.ts')).rejects.toThrow('not allowed');
  });

  it('rejects oversized and binary source, and unsupported audio formats', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'large.ts'), Buffer.alloc(2 * 1024 * 1024 + 1, 'a'));
    await writeFile(path.join(root, 'binary.ts'), Buffer.from([0, 1, 2]));
    const repo = await RepositoryAccess.open(root);
    await expect(repo.readSource('large.ts')).rejects.toThrow('too large');
    await expect(repo.readSource('binary.ts')).rejects.toThrow('Binary');
    await expect(repo.readAudio('src/index.ts')).rejects.toThrow('Unsupported');
  });
});
