import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Read version from package.json
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));
const uiVersion = packageJson.version;

export default defineConfig({
  root: '.',
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
    alias: [
      // Resolve blankslate CLI imports (for tablet-reader-base, node-hid-reader)
      { find: 'blankslate/cli/tablet-reader-base.js', replacement: resolve(__dirname, '../blankslate/dist/cli/tablet-reader-base.js') },
      { find: 'blankslate/cli/node-hid-reader.js', replacement: resolve(__dirname, '../blankslate/dist/cli/node-hid-reader.js') },
      // Resolve blankslate component imports directly (more specific paths first)
      { find: 'blankslate/components/hid-dashboard/hid-dashboard.js', replacement: resolve(__dirname, '../blankslate/dist/components/hid-dashboard/hid-dashboard.js') },
      { find: 'blankslate/components/hid-data-reader/hid-data-reader.js', replacement: resolve(__dirname, '../blankslate/dist/components/hid-data-reader/hid-data-reader.js') },
      { find: 'blankslate/components/tablet-visualizer/tablet-visualizer.js', replacement: resolve(__dirname, '../blankslate/dist/components/tablet-visualizer/tablet-visualizer.js') },
      { find: 'blankslate/components/bytes-display/bytes-display.js', replacement: resolve(__dirname, '../blankslate/dist/components/bytes-display/bytes-display.js') },
      { find: 'blankslate/components/events-display/events-display.js', replacement: resolve(__dirname, '../blankslate/dist/components/events-display/events-display.js') },
      { find: 'blankslate/models', replacement: resolve(__dirname, '../blankslate/dist/models/index.js') },
      // Resolve blankslate main export (for managers, types, etc.) - must be last
      { find: 'blankslate', replacement: resolve(__dirname, '../blankslate/dist/index.js') },
    ],
  },
  optimizeDeps: {
    // Exclude blankslate from pre-bundling so we always get fresh linked version
    exclude: ['blankslate'],
  },
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        tablet: resolve(__dirname, 'index.html'),
        web: resolve(__dirname, 'web.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: true,
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
