import { beforeEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import KeyValueView from './KeyValueView.svelte';
import { request } from '$lib/state/request.svelte';

beforeEach(() => {
	request.reset();
});

it('edits request fragments in place without writing localized labels', async () => {
	const styleId = request.addFragment({ label: 'style', text: 'Scandinavian ', order: 0 });
	const roomId = request.addFragment({ label: 'room', text: 'living room', order: 1 });

	const screen = render(KeyValueView);

	expect(
		(screen.getByRole('textbox', { name: 'Метка 1' }).element() as HTMLInputElement).value
	).toBe('style');
	expect(
		(screen.getByRole('textbox', { name: 'Текст 2' }).element() as HTMLInputElement).value
	).toBe('living room');

	await screen.getByRole('textbox', { name: 'Метка 1' }).fill('mood');
	await screen.getByRole('textbox', { name: 'Текст 2' }).fill('kitchen');
	await screen.getByRole('button', { name: 'Применить промпт ключ-значение' }).click();

	expect(request.toJSON().promptFragments).toEqual([
		expect.objectContaining({ id: styleId, label: 'mood', text: 'Scandinavian ', order: 0 }),
		expect.objectContaining({ id: roomId, label: 'room', text: 'kitchen', order: 1 })
	]);
	expect(request.toJSON().promptFragments.map((fragment) => fragment.label)).not.toContain('Стиль');
	expect(request.prompt).toBe('mood: Scandinavian\nroom: kitchen');
});
