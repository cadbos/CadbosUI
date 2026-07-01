import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

type ImageRouteEvent = Parameters<typeof GET>[0];

function mockBucket(object: unknown) {
	return { get: vi.fn(async () => object) };
}

function r2Object(contentType: string, body: string) {
	const bytes = new TextEncoder().encode(body);
	return {
		arrayBuffer: async () => bytes.buffer as ArrayBuffer,
		httpMetadata: { contentType },
		httpEtag: '"abc123"'
	};
}

function platform(bucket: ReturnType<typeof mockBucket>): App.Platform {
	return { env: { UPLOADS_BUCKET: bucket } } as unknown as App.Platform;
}

function call(event: Partial<ImageRouteEvent>): ReturnType<typeof GET> {
	return GET(event as ImageRouteEvent);
}

describe('/img R2 image proxy', () => {
	it('streams an R2 image with cache and content-type headers', async () => {
		const bucket = mockBucket(r2Object('image/jpeg', 'image-bytes'));

		const response = await call({
			params: { image: 'uuid-1234.jpg' },
			platform: platform(bucket)
		});

		expect(bucket.get).toHaveBeenCalledWith('uuid-1234.jpg');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/jpeg');
		expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(await response.text()).toBe('image-bytes');
	});

	it('returns 404 when the key is not in R2', async () => {
		const bucket = mockBucket(null);

		await expect(
			call({ params: { image: 'missing.jpg' }, platform: platform(bucket) })
		).rejects.toMatchObject({ status: 404 });
	});

	it('rejects invalid image paths before accessing storage', async () => {
		const bucket = mockBucket(null);

		await expect(
			call({ params: { image: 'file.txt' }, platform: platform(bucket) })
		).rejects.toMatchObject({ status: 400 });

		expect(bucket.get).not.toHaveBeenCalled();
	});
});
