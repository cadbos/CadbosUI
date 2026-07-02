import { describe, expect, it } from 'vitest';
import {
	imageExtensionFromMime,
	imageMimeMatchesExtension,
	parseProxyImageName
} from './image-utils';

describe('image utilities', () => {
	it('maps MIME types to canonical extensions', () => {
		expect(imageExtensionFromMime('image/jpeg')).toBe('jpg');
		expect(imageExtensionFromMime('image/png')).toBe('png');
		expect(imageExtensionFromMime('image/webp')).toBe('webp');
		expect(imageExtensionFromMime('image/avif')).toBe('avif');
		expect(imageExtensionFromMime('text/plain')).toBeNull();
	});

	it('checks image MIME type and extension compatibility', () => {
		expect(imageMimeMatchesExtension('image/jpeg; charset=binary', 'jpg')).toBe(true);
		expect(imageMimeMatchesExtension('image/jpeg', 'jpeg')).toBe(true);
		expect(imageMimeMatchesExtension('image/png', 'jpg')).toBe(false);
	});

	it('parses proxy image filenames into key and extension', () => {
		expect(parseProxyImageName('uuid-1234.jpg')).toEqual({
			fileKey: 'uuid-1234',
			extension: 'jpg'
		});
		expect(parseProxyImageName('a.b.c.png')).toEqual({ fileKey: 'a.b.c', extension: 'png' });
		expect(parseProxyImageName('file.txt')).toBeNull();
		expect(parseProxyImageName('.jpg')).toBeNull();
		expect(parseProxyImageName('noext')).toBeNull();
	});
});
