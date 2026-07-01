import { page } from 'vitest/browser';
import { beforeEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GraphView from './GraphView.svelte';
import { request } from '$lib/state/request.svelte';

// Reconnecting nodes by dragging edges on the canvas isn't practical to simulate with
// vitest-browser-svelte (no real pointer/canvas drag support); that interaction is
// covered at the Playwright e2e level instead.

beforeEach(async () => {
	request.reset();
	// The default test viewport is narrower than the graph view's 640px mobile
	// breakpoint, which hides the canvas by design (NFR-12). Widen it so these
	// tests exercise the desktop graph, not the mobile fallback message.
	await page.viewport(1024, 768);
});

it('adds a fragment node via the button and reflects it in the store', async () => {
	const screen = render(GraphView);

	await screen.getByRole('button', { name: 'Добавить узел фрагмента' }).click();

	expect(request.toJSON().promptFragments).toHaveLength(1);
	await expect.element(screen.getByRole('textbox', { name: 'Узел фрагмента 1' })).toBeVisible();
});

it("editing a fragment node's text updates the derived prompt", async () => {
	request.addFragment({ text: 'Scandinavian', order: 0 });

	const screen = render(GraphView);

	await screen.getByRole('textbox', { name: 'Узел фрагмента 1' }).fill('kitchen');

	expect(request.prompt).toBe('kitchen');
});

it('removing a fragment node removes it from the store', async () => {
	request.addFragment({ text: 'Scandinavian', order: 0 });
	request.addFragment({ text: 'kitchen', order: 1 });

	const screen = render(GraphView);

	await screen.getByRole('button', { name: 'Удалить узел фрагмента 1' }).click();

	expect(request.toJSON().promptFragments).toEqual([
		expect.objectContaining({ text: 'kitchen', order: 0 })
	]);
});
