import { expect, test } from '@playwright/test';

const ac9 = {
	imageUrl: 'https://example.ufs.sh/f/ac9-fixture-room',
	fragments: {
		style: 'Scandinavian ',
		room: 'living room, ',
		lighting: 'warm light'
	},
	prompt: 'Scandinavian living room, warm light',
	renderRequest: {
		image: 'https://example.ufs.sh/f/ac9-fixture-room',
		prompt: 'Scandinavian living room, warm light',
		outputFormat: 'webp'
	}
};

async function applyImage(page: import('@playwright/test').Page): Promise<void> {
	await page.getByLabel('URL изображения комнаты').fill(ac9.imageUrl);
	await page.getByRole('button', { name: 'Применить фото' }).click();
}

async function captureRequest(page: import('@playwright/test').Page): Promise<{
	prompt: string;
	renderRequest: unknown;
}> {
	await expect(page.getByLabel('Итоговый промпт')).toHaveText(ac9.prompt);
	await expect(page.getByLabel('Запрос на рендер')).not.toHaveText('null');
	return {
		prompt: (await page.getByLabel('Итоговый промпт').textContent()) ?? '',
		renderRequest: JSON.parse((await page.getByLabel('Запрос на рендер').textContent()) ?? 'null')
	};
}

test('renders the three-view workspace and switches views', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Чат' })).toHaveAttribute('aria-selected', 'true');

	await page.getByRole('tab', { name: 'Граф' }).click();
	await expect(page.getByRole('tab', { name: 'Граф' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByLabel('Узел стиля')).toBeVisible();
});

test('navigates tabs with the keyboard', async ({ page }) => {
	await page.goto('/');
	const chat = page.getByRole('tab', { name: 'Чат' });
	const keyValue = page.getByRole('tab', { name: 'Ключ-значение' });

	await chat.focus();
	await page.keyboard.press('ArrowRight');
	await expect(keyValue).toBeFocused();
	await expect(keyValue).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByLabel('Стиль')).toBeVisible();

	await page.keyboard.press('Home');
	await expect(chat).toBeFocused();
	await expect(chat).toHaveAttribute('aria-selected', 'true');
});

test('keeps prompt and render request identical across chat, key-value, and graph entry', async ({
	page
}) => {
	const captures = [];

	await page.goto('/');
	await applyImage(page);
	await page.getByLabel('Промпт чата').fill(ac9.prompt);
	await page.getByRole('button', { name: 'Применить промпт чата' }).click();
	captures.push(await captureRequest(page));

	await page.goto('/');
	await applyImage(page);
	await page.getByRole('tab', { name: 'Ключ-значение' }).click();
	await page.getByLabel('Стиль').fill(ac9.fragments.style);
	await page.getByLabel('Комната').fill(ac9.fragments.room);
	await page.getByLabel('Свет').fill(ac9.fragments.lighting);
	await page.getByRole('button', { name: 'Применить промпт ключ-значение' }).click();
	captures.push(await captureRequest(page));

	await page.goto('/');
	await applyImage(page);
	await page.getByRole('tab', { name: 'Граф' }).click();
	await page.getByLabel('Узел стиля').fill(ac9.fragments.style);
	await page.getByLabel('Узел комнаты').fill(ac9.fragments.room);
	await page.getByLabel('Узел света').fill(ac9.fragments.lighting);
	await page.getByRole('button', { name: 'Применить графовый промпт' }).click();
	captures.push(await captureRequest(page));

	for (const capture of captures) {
		expect(capture.prompt).toBe(ac9.prompt);
		expect(capture.renderRequest).toEqual(ac9.renderRequest);
	}
	expect(new Set(captures.map((capture) => JSON.stringify(capture))).size).toBe(1);
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
