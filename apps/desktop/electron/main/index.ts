import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RepositoryAccess } from '../../../../packages/repository/access';
import { SpeechService } from '../../../../packages/speech/service';
import { speechRequestSchema } from '../../../../packages/speech/contract';
import { LessonGenerationService } from '../../../../packages/agents/service';
import { generationRequestSchema, isLessonSource } from '../../../../packages/agents/contract';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'codecast',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const devURL = process.env.CODECAST_DEV_URL;
const rendererRoot = path.resolve(__dirname, '../renderer');
let window: BrowserWindow | null = null;
let repository: RepositoryAccess | null = null;
let speech: SpeechService;
let lessons: LessonGenerationService;

function checkSender(event: Electron.IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  const url = frame ? new URL(frame.url) : null;
  const trusted =
    url &&
    (devURL
      ? url.origin === new URL(devURL).origin
      : url.protocol === 'codecast:' && url.host === 'app');
  if (
    !window ||
    event.sender !== window.webContents ||
    frame !== window.webContents.mainFrame ||
    !trusted
  ) {
    throw new Error('Untrusted IPC request.');
  }
}

function currentRepository() {
  if (!repository) throw new Error('Open a repository first.');
  return repository;
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: '#f4f5ef',
    title: 'CodeCast',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) {
      speech.cancel();
      lessons.cancel();
    }
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.on('closed', () => {
    speech.cancel();
    lessons.cancel();
    window = null;
    repository = null;
  });
  if (devURL) await window.loadURL(devURL);
  else await window.loadURL('codecast://app/index.html');
}

app.whenReady().then(async () => {
  lessons = new LessonGenerationService({
    dataDirectory:
      process.env.CODECAST_GENERATION_DATA_DIR ?? path.join(app.getPath('userData'), 'generation'),
  });
  speech = new SpeechService({
    projectRoot: app.getAppPath(),
    dataDirectory: path.resolve(
      process.env.CODECAST_TTS_DATA_DIR ?? path.join(app.getPath('userData'), 'speech'),
    ),
    python: process.env.CODECAST_TTS_PYTHON,
  });
  protocol.handle('codecast', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Forbidden', { status: 403 });
    const asset = path.resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`);
    const relative = path.relative(rendererRoot, asset);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(asset).toString());
  });
  ipcMain.handle('repository:open', async (event) => {
    checkSender(event);
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] });
    if (result.canceled) return null;
    const candidate = await RepositoryAccess.open(result.filePaths[0]);
    const summary = await candidate.summary();
    lessons.cancel();
    repository = candidate;
    return summary;
  });
  ipcMain.handle('repository:source', (event, file: unknown) => {
    checkSender(event);
    if (typeof file !== 'string') throw new Error('Invalid file path.');
    return currentRepository().readSource(file);
  });
  ipcMain.handle('repository:audio', (event, file: unknown) => {
    checkSender(event);
    if (typeof file !== 'string') throw new Error('Invalid file path.');
    return currentRepository().readAudio(file);
  });
  ipcMain.handle('lesson:open', async (event) => {
    checkSender(event);
    const repo = currentRepository();
    const result = await dialog.showOpenDialog(window!, {
      defaultPath: repo.directory,
      filters: [{ name: 'CodeLesson JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return null;
    return repo.readSource(
      path.relative(repo.directory, result.filePaths[0]).split(path.sep).join('/'),
    );
  });
  ipcMain.handle('speech:status', (event) => {
    checkSender(event);
    return speech.status();
  });
  ipcMain.handle('agents:list', (event) => {
    checkSender(event);
    return lessons.detect();
  });
  ipcMain.handle('agents:files', async (event) => {
    checkSender(event);
    return (await currentRepository().summary()).files.filter(isLessonSource);
  });
  ipcMain.handle('agents:generate', async (event, request: unknown) => {
    checkSender(event);
    const parsed = generationRequestSchema.safeParse(request);
    if (!parsed.success)
      throw new Error(`Invalid generation request: ${parsed.error.issues[0].message}`);
    const repo = currentRepository();
    const result = await lessons.generate(repo, parsed.data, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('agents:progress', progress);
    });
    if (repository !== repo)
      throw new Error(
        'Repository changed during generation. Generate a lesson for the current folder.',
      );
    return result;
  });
  ipcMain.handle('agents:cancel', (event) => {
    checkSender(event);
    lessons.cancel();
  });
  ipcMain.handle('speech:prepare', (event) => {
    checkSender(event);
    return speech.prepare((progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('speech:progress', progress);
    });
  });
  ipcMain.handle('speech:generate', (event, request: unknown) => {
    checkSender(event);
    const parsed = speechRequestSchema.safeParse(request);
    if (!parsed.success)
      throw new Error(`Invalid narration request: ${parsed.error.issues[0].message}`);
    return speech.generate(parsed.data, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('speech:progress', progress);
    });
  });
  ipcMain.handle('speech:cancel', (event) => {
    checkSender(event);
    speech.cancel();
  });
  ipcMain.handle('speech:audio', (event, cacheKey: unknown) => {
    checkSender(event);
    if (typeof cacheKey !== 'string') throw new Error('Invalid speech cache key.');
    return speech.readAudio(cacheKey);
  });
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  speech?.cancel();
  lessons?.cancel();
});
