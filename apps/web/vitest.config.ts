import { defineConfig } from 'vitest/config';

// Pruebas unitarias de la web (las de navegador están en e2e/ con Playwright).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
