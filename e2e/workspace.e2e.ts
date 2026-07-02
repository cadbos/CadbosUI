import { expect, test } from '@playwright/test';

test('renders the workspace with chat as the default, reachable view', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Чат' })).toHaveAttribute('aria-selected', 'true');
});

test('keeps key-value and graph tabs disabled and un-selectable', async ({ page }) => {
	await page.goto('/');
	const chat = page.getByRole('tab', { name: 'Чат' });

	for (const name of ['Ключ-значение', 'Граф']) {
		const tab = page.getByRole('tab', { name });
		await expect(tab).toHaveAttribute('aria-disabled', 'true');
		// Forced past Playwright's actionability check since the tab is legitimately
		// non-interactive (pointer-events: none) — clicking it must stay a no-op.
		await tab.click({ force: true });
		await expect(tab).toHaveAttribute('aria-selected', 'false');
	}
	await expect(chat).toHaveAttribute('aria-selected', 'true');
});

test('navigates with the keyboard without leaving the only enabled tab', async ({ page }) => {
	await page.goto('/');
	const chat = page.getByRole('tab', { name: 'Чат' });

	await chat.focus();
	await page.keyboard.press('ArrowRight');
	await expect(chat).toBeFocused();
	await expect(chat).toHaveAttribute('aria-selected', 'true');
});

test('serves security headers and a content security policy', async ({ request }) => {
	const response = await request.get('/');
	const headers = response.headers();

	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect(headers['permissions-policy']).toContain('geolocation=()');
	expect(headers['content-security-policy']).toContain("default-src 'self'");
});
