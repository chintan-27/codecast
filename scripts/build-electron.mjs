import { build } from 'esbuild';

export async function buildElectron() {
  await build({
    entryPoints: {
      main: 'apps/desktop/electron/main/index.ts',
      preload: 'apps/desktop/electron/preload/index.ts',
    },
    outdir: 'dist/electron',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    target: 'node22',
  });
}

await buildElectron();
