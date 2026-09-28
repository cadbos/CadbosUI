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
import { z } from 'zod';
import {
	describeCause,
	formatCredit,
	issuePaths,
	logBoundaryError,
	toBoundaryErrorLog
} from './utils';

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

it('logs the underlying cause an error wraps', () => {
	const error = new Error('project detail request failed', {
		cause: new TypeError('Failed to fetch')
	});

	expect(toBoundaryErrorLog('workspace.urlTarget', error).cause).toBe('TypeError: Failed to fetch');
});

it('never logs a non-Error cause, which could carry private data', () => {
	const error = new Error('failed', { cause: { email: 'private@example.test' } });

	expect(toBoundaryErrorLog('workspace.urlTarget', error)).not.toHaveProperty('cause');
});

it('describes an error value as name and message', () => {
	expect(describeCause(new TypeError('Failed to fetch'))).toBe('TypeError: Failed to fetch');
	expect(describeCause('boom')).toBe('non-Error value');
});

it('lists where validation failed without the offending values', () => {
	const result = z
		.object({ title: z.string(), sessions: z.array(z.object({ id: z.string() })) })
		.safeParse({ title: 'secret title value', sessions: [{ id: 7 }], extra: 1 });
	if (result.success) throw new Error('expected a validation failure');

	const paths = issuePaths(result.error);

	expect(paths).toBe('sessions.0.id');
	expect(paths).not.toContain('secret');
});
