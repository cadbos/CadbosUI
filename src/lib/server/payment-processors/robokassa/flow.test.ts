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

import { describe, expect, it } from 'vitest';
import { handleRobokassaResult } from './result';

function request(fields: Record<string, string> = {}): Request {
	return new Request(
		`https://app.cadbos.com/api/robokassa/result?${new URLSearchParams({
			InvId: '42',
			OutSum: '825.00',
			SignatureValue: '0'.repeat(32),
			...fields
		})}`
	);
}

async function expectInvalid(value: Request): Promise<void> {
	const response = await handleRobokassaResult(undefined, value);
	expect(response.status).toBe(400);
	expect(response.headers.get('cache-control')).toBe('no-store');
	await expect(response.text()).resolves.toBe('Invalid notification');
}

describe('Robokassa result query validation before database access', () => {
	it.each(['InvId', 'OutSum', 'SignatureValue'])('rejects missing %s', async (key) => {
		const url = new URL(request().url);
		url.searchParams.delete(key);
		await expectInvalid(new Request(url));
	});
	it.each([
		'',
		'0',
		'01',
		'-1',
		'1.5',
		'9007199254740992',
		'abc',
		'42\n',
		' 42',
		'4.2e1',
		'00000000-0000-4000-8000-000000000042'
	])('rejects malformed provider ID %s', async (InvId) => {
		await expectInvalid(request({ InvId }));
	});
	it.each(['', '0', '-1', '825.001', '1e1', 'Infinity', '90071992547409.92'])(
		'rejects malformed or unpayable amount %s',
		async (OutSum) => {
			await expectInvalid(request({ OutSum }));
		}
	);
	it.each([
		'&OutSum=825.00',
		'&%4FutSum=825.00',
		'&InvId=42',
		'&SignatureValue=x',
		'&extra=' + 'a'.repeat(16384)
	])('rejects duplicate or oversized query case %#', async (suffix) => {
		await expectInvalid(new Request(request().url + suffix));
	});
});
