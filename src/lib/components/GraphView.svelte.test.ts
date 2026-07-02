import { beforeEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GraphView from './GraphView.svelte';
import { request } from '$lib/state/request.svelte';

beforeEach(() => {
	request.reset();
});

it('hydrates fields from request fragments and preserves labels/ids on apply', async () => {
	const styleId = request.addFragment({ label: 'Style', text: 'Scandinavian ', order: 0 });
	const roomId = request.addFragment({ label: 'Room', text: 'living room', order: 1 });

	const screen = render(GraphView);

	expect(
		(screen.getByRole('textbox', { name: 'Узел фрагмента 1' }).element() as HTMLInputElement).value
	).toBe('Scandinavian ');
	expect(
		(screen.getByRole('textbox', { name: 'Узел фрагмента 2' }).element() as HTMLInputElement).value
	).toBe('living room');

	await screen.getByRole('textbox', { name: 'Узел фрагмента 2' }).fill('kitchen');
	await screen.getByRole('button', { name: 'Применить графовый промпт' }).click();

	// Labels and ids survive the round-trip — only edited text (and order) change.
	expect(request.toJSON().promptFragments).toEqual([
		expect.objectContaining({ id: styleId, label: 'Style', text: 'Scandinavian ', order: 0 }),
		expect.objectContaining({ id: roomId, label: 'Room', text: 'kitchen', order: 1 })
	]);
	expect(request.prompt).toBe('Style: Scandinavian\nRoom: kitchen');
});
