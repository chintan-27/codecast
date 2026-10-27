import type { RepositorySummary } from '../../../packages/core/contracts';
import { isSafeRelativePath } from '../../../packages/core/lesson';

export interface Repository extends RepositorySummary {
  kind: 'demo' | 'local';
  readSource(path: string): Promise<string>;
  readAudio(path: string): Promise<string>;
}

export function browserRepository(fileList: FileList): Repository {
  const files = new Map<string, File>();
  let root = 'Local project';
  for (const file of Array.from(fileList)) {
    const [folder, ...parts] = file.webkitRelativePath.split('/');
    root = folder;
    const relative = parts.join('/');
    if (!isSafeRelativePath(relative)) continue;
    if (
      parts.some(
        (part) =>
          /^(?:\.git|\.aws|\.ssh|\.codex|\.agents|node_modules|dist|build|\.venv|coverage)$/.test(
            part,
          ) ||
          /^\.env(?:\.|$)/.test(part) ||
          /(?:^|[._-])(?:credentials|secrets?)(?:[._-]|$)/i.test(part) ||
          /\.(?:pem|key|p12|pfx)$/i.test(part),
      )
    )
      continue;
    if (files.size < 5000) files.set(relative, file);
  }
  const read = (path: string, maxBytes: number) => {
    const file = files.get(path);
    if (!isSafeRelativePath(path) || !file) throw new Error(`File not found: ${path}`);
    if (file.size > maxBytes) throw new Error(`File is too large: ${path}`);
    return file;
  };
  return {
    name: root,
    kind: 'local',
    files: [...files.keys()].sort(),
    truncated: files.size >= 5000,
    readSource: async (path) => {
      const text = await read(path, 2 * 1024 * 1024).text();
      if (text.includes('\0')) throw new Error('Binary files cannot be displayed as source.');
      return text;
    },
    readAudio: async (path) => {
      if (!/\.(wav|mp3|ogg|m4a)$/i.test(path)) throw new Error('Unsupported audio format.');
      const file = read(path, 25 * 1024 * 1024);
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Cannot read audio file.'));
        reader.readAsDataURL(file);
      });
    },
  };
}
