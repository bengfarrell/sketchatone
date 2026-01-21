import { beforeAll, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Setup for web components testing
beforeAll(() => {
  // Any global setup for tests
});

afterEach(() => {
  // Cleanup after each test
  document.body.innerHTML = '';
});
