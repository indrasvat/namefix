import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			include: ['src/core/**/*.ts', 'src/utils/**/*.ts', 'src/integrations/**/*.ts'],
			exclude: [
				'src/**/*.spec.ts',
				'src/core/App.ts',
				'src/tui/**',
				'src/types/**',
				'dist/**',
				'coverage/**',
			],
			reporter: ['text', 'json-summary'],
			thresholds: {
				statements: 85,
				branches: 85,
				functions: 85,
				lines: 85,
			},
		},
	},
});
