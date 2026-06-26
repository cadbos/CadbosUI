import { describe, it, expect } from 'vitest';
import { mockChallenge, mockMe, mockRender, mockUpload } from '$lib/server/mocks/fixtures';

describe('mock fixtures match the API contract', () => {
	it('challenge', () => {
		expect(mockChallenge()).toEqual({ challenge: expect.any(String) });
	});

	it('me', () => {
		const me = mockMe();
		expect(me.user.pubkey).toEqual(expect.any(String));
		expect(me.quota).toMatchObject({
			balanceOrLimit: expect.any(Number),
			usage: expect.any(Number),
			period: expect.any(String)
		});
	});

	it('upload', () => {
		expect(mockUpload()).toMatchObject({
			url: expect.any(String),
			mime: expect.any(String),
			size: expect.any(Number)
		});
	});

	it('render', () => {
		expect(mockRender()).toMatchObject({
			outputUrl: expect.any(String),
			cost: expect.any(Number),
			balance: expect.any(Number)
		});
	});
});
