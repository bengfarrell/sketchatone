import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Read version from package.json
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));
const uiVersion = packageJson.version;

export default defineConfig({
  root: '.',
  base: './', // Use relative paths for assets (needed for Electron file:// protocol)
  define: {
    __UI_VERSION__: JSON.stringify(uiVersion),
    __UI_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    preserveSymlinks: false,
    dedupe: [
      // Dedupe Lit to prevent multiple instances
      'lit',
      'lit-element',
      'lit-html',
      '@lit/reactive-element',
    ],
  },
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        tablet: resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: false, // Don't auto-open browser when running with Electron
    strictPort: true, // Fail if port 3000 is in use
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test/setup.ts',
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000, // Some tests (like CLI integration) may take longer
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.spec.ts',
        '**/*.test.ts',
        'dist/',
      ],
    },
  },
});
