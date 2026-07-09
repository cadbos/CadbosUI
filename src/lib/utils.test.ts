/*
 * Copyright (c) 2026 Cadbos company. All rights reserved.
 *
 * SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1
 *
 * Cadbos Interior Design AI is licensed under the Business Source License 1.1.
 * Access is limited to automated analysis tools for analysis of this repository.
 * This code is not open for contribution or usage except under a separate
 * written agreement with Cadbos company.
 *
 * Commercial use in Interior Design & AEC Generative AI Services is prohibited
 * before the Change Date. See LICENSE for complete terms.
 */

import { expect, it, vi } from 'vitest';
import { formatCredit, logBoundaryError, toBoundaryErrorLog } from './utils';

it('rounds binary floating-point noise to two decimals', () => {
	expect(formatCredit(4.9399999999999995)).toBe('4.94');
});

it('pads whole numbers to two decimals', () => {
	expect(formatCredit(48)).toBe('48.00');
});

it('keeps exact two-decimal values unchanged', () => {
	expect(formatCredit(2.5)).toBe('2.50');
});

it('normalizes Error values for component boundary logs', () => {
	const error = new TypeError('Render failed');
	const log = toBoundaryErrorLog('workspace.renderResult', error);

	expect(log).toMatchObject({
		scope: 'workspace.renderResult',
		name: 'TypeError',
		message: 'Render failed'
	});
	expect(log.stack).toContain('TypeError');
});

it('normalizes non-Error values for component boundary logs', () => {
	expect(toBoundaryErrorLog('promptViews.graph', { detail: 'private' })).toEqual({
		scope: 'promptViews.graph',
		name: 'NonError',
		message: 'Component boundary failed with a non-Error value'
	});
});

it('logs component boundary errors with a normalized payload', () => {
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
	const error = new Error('Graph failed');

	logBoundaryError('promptViews.graph', error);

	expect(consoleError).toHaveBeenCalledWith(
		'Component boundary failed:',
		expect.objectContaining({
			scope: 'promptViews.graph',
			name: 'Error',
			message: 'Graph failed'
		})
	);

	consoleError.mockRestore();
});
