import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { isSafeRelativePath } from '../core/lesson';
import type { RepositorySummary } from '../core/contracts';

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 5000;
const excluded = new Set([
  '.git',
  '.aws',
  '.ssh',
  '.codex',
  '.agents',
  '.claude',
  '.opencode',
  '.cursor',
  '.vscode',
  '.cache',
  '.tts-cache',
  'node_modules',
  'dist',
  'build',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  'coverage',
  'target',
]);

function isExcluded(relativePath: string) {
  return relativePath
    .split('/')
    .some(
      (part) =>
        excluded.has(part) ||
        /^\.env(?:\.|$)/i.test(part) ||
        /(?:^|[._-])(?:credentials|secrets?)(?:[._-]|$)/i.test(part) ||
        /\.(?:pem|key|p12|pfx)$/i.test(part),
    );
}

export class RepositoryAccess {
  private constructor(private readonly root: string) {}

  static async open(root: string) {
    const resolved = await realpath(root);
    if (!(await stat(resolved)).isDirectory()) throw new Error('Select a repository folder.');
    return new RepositoryAccess(resolved);
  }

  get directory() {
    return this.root;
  }

  async resolve(relativePath: string) {
    if (!isSafeRelativePath(relativePath) || isExcluded(relativePath)) {
      throw new Error('This path is not allowed.');
    }
    const resolved = await realpath(path.join(this.root, relativePath));
    const relative = path.relative(this.root, resolved);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative)
    ) {
      throw new Error('Path is outside the selected repository.');
    }
    if (isExcluded(relative.split(path.sep).join('/')))
      throw new Error('This path is not allowed.');
    return resolved;
  }

  private async read(relativePath: string, maxBytes: number) {
    const resolved = await this.resolve(relativePath);
    const info = await stat(resolved);
    if (!info.isFile() || info.size > maxBytes)
      throw new Error('File is too large or is not a regular file.');
    const buffer = await readFile(resolved);
    if (buffer.length > maxBytes) throw new Error('File is too large.');
    return buffer;
  }

  async readSource(relativePath: string) {
    const buffer = await this.read(relativePath, MAX_SOURCE_BYTES);
    if (buffer.includes(0)) throw new Error('Binary files cannot be displayed as source.');
    return buffer.toString('utf8');
  }

  async readAudio(relativePath: string) {
    const extension = path.extname(relativePath).toLowerCase();
    const mime: Record<string, string> = {
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
    };
    if (!mime[extension]) throw new Error('Unsupported audio format. Use WAV, MP3, OGG, or M4A.');
    const buffer = await this.read(relativePath, MAX_AUDIO_BYTES);
    return `data:${mime[extension]};base64,${buffer.toString('base64')}`;
  }

  async summary(): Promise<RepositorySummary> {
    const files: string[] = [];
    let truncated = false;
    let directories = 0;
    type RuleLayer = { prefix: string; rules: ReturnType<typeof ignore> };
    const visit = async (directory: string, prefix: string, parentRules: RuleLayer[]) => {
      if (++directories > 10000) {
        truncated = true;
        return;
      }
      const localRules = [...parentRules];
      try {
        localRules.push({
          prefix,
          rules: ignore().add(await this.readSource(`${prefix}.gitignore`)),
        });
      } catch {
        /* Optional ignore file. */
      }
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const relative = `${prefix}${entry.name}`;
        const candidate = relative + (entry.isDirectory() ? '/' : '');
        let ignored = false;
        for (const layer of localRules) {
          const result = layer.rules.test(candidate.slice(layer.prefix.length));
          if (result.ignored) ignored = true;
          else if (result.unignored) ignored = false;
        }
        if (entry.isSymbolicLink() || isExcluded(relative) || ignored) continue;
        if (files.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        if (entry.isDirectory())
          await visit(path.join(directory, entry.name), `${relative}/`, localRules);
        else if (entry.isFile()) files.push(relative);
        if (truncated) return;
      }
    };
    await visit(this.root, '', []);
    return { name: path.basename(this.root), files, truncated };
  }
}
