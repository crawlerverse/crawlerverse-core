import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'lib/**/__tests__/**/*.test.ts',
      'components/**/__tests__/**/*.test.tsx',
      'hooks/**/__tests__/**/*.test.{ts,tsx}',
      'scripts/**/__tests__/**/*.test.ts',
      'bin/**/__tests__/**/*.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['lib/**/*.ts', 'components/**/*.tsx', 'hooks/**/*.ts'],
      exclude: [
        'lib/**/__tests__/**',
        'components/**/__tests__/**',
        'hooks/**/__tests__/**',
        'lib/**/index.ts',
        'lib/**/*.d.ts',
        'components/**/__tests__/**',
      ],
    },
  },
});
