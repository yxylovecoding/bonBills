import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('dist-server', { recursive: true, force: true });
await build({
  entryPoints: ['server/index.ts'], outdir: 'dist-server',
  bundle: true, splitting: true, format: 'esm', platform: 'node',
  target: 'es2022', packages: 'external', sourcemap: false,
});
console.log('Portable API server built');
