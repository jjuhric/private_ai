import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extends Vitest's expect method with testing-library matchers
expect.extend(matchers);

// Runs cleanup after each test case
afterEach(() => {
  cleanup();
});
