import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Workspace from './Workspace.svelte';

describe('Workspace', () => {
	it('renders the chat view by default', async () => {
		const screen = render(Workspace);
		await expect
			.element(screen.getByRole('tab', { name: 'Чат' }))
			.toHaveAttribute('aria-selected', 'true');
		await expect.element(screen.getByText('Чат-интерфейс появится здесь.')).toBeInTheDocument();
	});

	it('switches views without losing the others', async () => {
		const screen = render(Workspace);
		await screen.getByRole('tab', { name: 'Граф' }).click();
		await expect
			.element(screen.getByRole('tab', { name: 'Граф' }))
			.toHaveAttribute('aria-selected', 'true');
		await expect.element(screen.getByText('Граф-интерфейс появится здесь.')).toBeInTheDocument();

		await screen.getByRole('tab', { name: 'Ключ-значение' }).click();
		await expect
			.element(screen.getByText('Интерфейс «ключ-значение» появится здесь.'))
			.toBeInTheDocument();
	});
});
