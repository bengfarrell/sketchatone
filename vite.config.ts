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
      // Dedupe Spectrum Web Components
      '@spectrum-web-components/base',
      '@spectrum-web-components/theme',
      '@spectrum-web-components/button',
      '@spectrum-web-components/action-button',
      '@spectrum-web-components/icon',
      '@spectrum-web-components/icons',
      '@spectrum-web-components/icons-workflow',
      '@spectrum-web-components/progress-circle',
      '@spectrum-web-components/tooltip',
      '@spectrum-web-components/overlay',
      '@spectrum-web-components/reactive-controllers',
      '@spectrum-web-components/shared',
      // New components for strum visualizers
      '@spectrum-web-components/checkbox',
      '@spectrum-web-components/picker',
      '@spectrum-web-components/menu',
      '@spectrum-web-components/number-field',
      '@spectrum-web-components/field-label',
      '@spectrum-web-components/textfield',
      '@spectrum-web-components/popover',
      '@spectrum-web-components/tray',
    ],
  },
  optimizeDeps: {
    // Include blankslate for pre-bundling from node_modules
    include: ['blankslate'],
  },
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        tablet: resolve(__dirname, 'index.html'),
        web: resolve(__dirname, 'web.html'),
      },
      // Externalize Node.js-only modules that shouldn't be bundled for browser
      // This is needed because blankslate's main export includes mockbytes which uses 'fs'
      external: [
        'fs',
        'path',
      ],
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
