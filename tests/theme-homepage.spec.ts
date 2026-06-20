import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const baseURL = process.env.WP_BASE_URL ?? 'http://localhost:8889';

test.describe('P0 — Homepage', () => {
	test.use({ baseURL });

	test('loads with H1 and no console errors', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));
		const response = await page.goto('/');
		expect(response?.status()).toBe(200);
		await expect(page.locator('h1').first()).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('skip link targets main content', async ({ page }) => {
		await page.goto('/');
		await page.keyboard.press('Tab');
		const skip = page.getByRole('link', { name: 'Skip to content' });
		await expect(skip).toBeFocused();
		await skip.press('Enter');
		await expect(page.locator('#content')).toBeVisible();
	});

	test('mobile nav opens and closes with Escape', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto('/');
		const toggle = page.locator('.mobile-nav-toggle');
		await expect(toggle).toBeVisible();
		await toggle.click();
		await expect(page.locator('#mobile-nav-panel')).toHaveClass(/is-open/);
		await page.keyboard.press('Escape');
		await expect(page.locator('#mobile-nav-panel')).not.toHaveClass(/is-open/);
	});

	test('passes axe accessibility scan', async ({ page }) => {
		await page.goto('/');
		await page.waitForTimeout(400);
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(results.violations).toEqual([]);
	});
});
