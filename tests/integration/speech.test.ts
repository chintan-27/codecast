import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SpeechService } from '../../packages/speech/service';
import { speechRequestSchema } from '../../packages/speech/contract';

const directories: string[] = [];
async function fixture(script: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codecast-speech-'));
  directories.push(root);
  await mkdir(path.join(root, 'services/tts'), { recursive: true });
  await writeFile(path.join(root, 'services/tts/sidecar.py'), script);
  return {
    root,
    service: new SpeechService({
      projectRoot: root,
      dataDirectory: path.join(root, 'data'),
      python: process.platform === 'win32' ? 'python' : 'python3',
    }),
  };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('speech boundary', () => {
  it('validates voice, batch size, and duplicate IDs before starting Python', () => {
    expect(
      speechRequestSchema.safeParse({ voice: '../file.pt', steps: [{ id: 'a', text: 'Hello' }] })
        .success,
    ).toBe(false);
    expect(
      speechRequestSchema.safeParse({
        voice: 'af_heart',
        steps: [
          { id: 'a', text: 'Hello' },
          { id: 'a', text: 'Again' },
        ],
      }).success,
    ).toBe(false);
  });

  it('reports an absent environment with an actionable setup command', async () => {
    const service = new SpeechService({
      projectRoot: '/missing-codecast-project',
      dataDirectory: '/tmp/codecast-unused',
    });
    expect(await service.status()).toMatchObject({
      available: false,
      ready: false,
      message: expect.stringContaining('npm run setup:tts'),
    });
  });

  it('handles progress and typed clips without passing text through command arguments', async () => {
    const { service } = await fixture(
      `import json, sys\nrequest = json.loads(sys.stdin.readline())\nassert 'private narration' not in ' '.join(sys.argv)\nprint(json.dumps({'type':'progress','phase':'generating','completed':0,'total':1,'message':'Working'}), flush=True)\nprint(json.dumps({'type':'done','clips':[{'stepId':request['steps'][0]['id'],'cacheKey':'a'*64,'durationSeconds':1,'cached':False}]}), flush=True)\n`,
    );
    const progress: string[] = [];
    const clips = await service.generate(
      { voice: 'af_heart', steps: [{ id: 'intro', text: 'private narration' }] },
      (event) => progress.push(event.message),
    );
    expect(progress).toEqual(['Working']);
    expect(clips[0]).toMatchObject({ stepId: 'intro', durationSeconds: 1 });
  });

  it('rejects concurrent jobs, terminates on cancellation, and releases the slot', async () => {
    const { service } = await fixture(
      `import json, sys, time\njson.loads(sys.stdin.readline())\nprint(json.dumps({'type':'progress','phase':'loading','completed':0,'total':1,'message':'Loaded'}), flush=True)\ntime.sleep(30)\n`,
    );
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const pending = service.prepare(() => ready());
    const rejected = expect(pending).rejects.toThrow('canceled');
    await started;
    await expect(service.prepare(() => {})).rejects.toThrow('Another speech job');
    service.cancel();
    await rejected;
    // Starting again confirms the canceled job no longer holds the slot.
    const again = service.prepare(() => service.cancel());
    await expect(again).rejects.toThrow('canceled');
  });

  it('rejects malformed protocol and mismatched step responses', async () => {
    const { service } = await fixture(`print('not json', flush=True)\n`);
    await expect(service.prepare(() => {})).rejects.toThrow('invalid response');
    const other = await fixture(
      `import json\nprint(json.dumps({'type':'done','clips':[{'stepId':'wrong','cacheKey':'a'*64,'durationSeconds':1,'cached':True}]}), flush=True)\n`,
    );
    await expect(
      other.service.generate(
        { voice: 'af_heart', steps: [{ id: 'intro', text: 'Hello' }] },
        () => {},
      ),
    ).rejects.toThrow('mismatched steps');
  });

  it('reads only cache keys and blocks symlink escapes', async () => {
    const { root, service } = await fixture('');
    const cache = path.join(root, 'data/audio');
    await mkdir(cache, { recursive: true });
    await writeFile(path.join(cache, `${'a'.repeat(64)}.wav`), 'audio');
    expect(await service.readAudio('a'.repeat(64))).toBe('data:audio/wav;base64,YXVkaW8=');
    await expect(service.readAudio('../outside')).rejects.toThrow('Invalid speech cache key');
    if (process.platform !== 'win32') {
      await writeFile(path.join(root, 'outside.wav'), 'outside');
      await symlink(path.join(root, 'outside.wav'), path.join(cache, `${'b'.repeat(64)}.wav`));
      await expect(service.readAudio('b'.repeat(64))).rejects.toThrow('not allowed');
    }
  });
});
