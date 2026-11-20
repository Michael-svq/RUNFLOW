import { defineConfig } from 'tsup';

// El lanzador: arranca PostgreSQL integrado y el servidor de RunFlow (que se
// distribuye compilado junto a él, en ./server, con la web en ./web).
export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
