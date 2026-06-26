import { describe, it, expect } from 'vitest';
import { mockRender, mockUpload } from '$lib/server/mocks/fixtures';

describe('mock fixtures match the API contract', () => {
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
