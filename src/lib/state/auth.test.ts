import { describe, expect, it } from 'vitest';
import { normalizeProfileUpdate } from './auth.svelte';

describe('normalizeProfileUpdate', () => {
	it('trims, clamps, and nulls Cadbos profile names before submit', () => {
		expect(
			normalizeProfileUpdate({
				firstName: '  Ada  ',
				lastName: `  ${'L'.repeat(90)}  `
			})
		).toEqual({
			firstName: 'Ada',
			lastName: 'L'.repeat(80)
		});

		expect(normalizeProfileUpdate({ firstName: '   ', lastName: null })).toEqual({
			firstName: null,
			lastName: null
		});
	});

	it('keeps omitted profile fields omitted', () => {
		expect(normalizeProfileUpdate({ firstName: ' Grace ' })).toEqual({ firstName: 'Grace' });
	});
});
