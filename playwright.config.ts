import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: 'pnpm run build && pnpm run preview', port: 4173 },
	use: { baseURL: 'http://localhost:4173' },
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}'
});
