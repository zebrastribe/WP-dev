import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.WP_BASE_URL ?? 'http://localhost:8889';

export default defineConfig({
	testDir: './tests',
	testMatch: 'theme-homepage.spec.ts',
	fullyParallel: true,
	reporter: 'list',
	use: {
		baseURL,
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Pixel 5'], channel: 'chrome' },
		},
	],
});
