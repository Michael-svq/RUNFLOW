import { cp } from 'node:fs/promises';
import { defineConfig } from 'tsup';

// Un único bundle con los paquetes del monorepo incluidos: base para el
// contenedor de la nube y para RunFlow Station.
export default defineConfig({
  entry: { index: 'src/index.ts', migrate: 'src/migrate-cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@runflow\//],
  async onSuccess() {
    await cp('../../packages/db/migrations', 'dist/migrations', { recursive: true });
  },
});
