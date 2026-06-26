import { expect, test } from '@playwright/test';

test('renders the three-view workspace and switches views', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Чат' })).toHaveAttribute('aria-selected', 'true');

	await page.getByRole('tab', { name: 'Граф' }).click();
	await expect(page.getByRole('tab', { name: 'Граф' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByText('Граф-интерфейс появится здесь.')).toBeVisible();
});

test('navigates tabs with the keyboard', async ({ page }) => {
	await page.goto('/');
	const chat = page.getByRole('tab', { name: 'Чат' });
	const keyValue = page.getByRole('tab', { name: 'Ключ-значение' });

	await chat.focus();
	await page.keyboard.press('ArrowRight');
	await expect(keyValue).toBeFocused();
	await expect(keyValue).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByText('Интерфейс «ключ-значение» появится здесь.')).toBeVisible();

	await page.keyboard.press('Home');
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
