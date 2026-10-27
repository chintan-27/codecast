import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(root, 'services/tts');
const python = path.join(
  project,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const appData =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library/Application Support')
    : process.platform === 'win32'
      ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData/Roaming'))
      : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
const dataDirectory = process.env.CODECAST_TTS_DATA_DIR ?? path.join(appData, 'codecast/speech');

async function run(command, args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'],
      windowsHide: true,
    });
    child.on('error', (error) =>
      reject(
        new Error(
          error.code === 'ENOENT' && command === 'uv'
            ? 'Install uv first (https://docs.astral.sh/uv/getting-started/installation/), then run npm run setup:tts again.'
            : error.message,
        ),
      ),
    );
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)),
    );
    if (input) child.stdin.end(input + '\n');
  });
}

try {
  console.log('Installing the isolated Python 3.12 speech engine…');
  await run('uv', ['sync', '--locked', '--project', project, '--python', '3.12']);
  console.log('Downloading Kokoro and four voices. Lesson text is never uploaded.');
  await run(
    python,
    [path.join(project, 'sidecar.py'), '--data-dir', dataDirectory],
    JSON.stringify({ operation: 'prepare' }),
  );
  console.log('Kokoro is ready. Open CodeCast and choose Narration to generate speech.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
