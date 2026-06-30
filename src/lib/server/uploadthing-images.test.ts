import { describe, expect, it } from 'vitest';
import {
	imageExtensionFromMime,
	imageMimeMatchesExtension,
	parseProxyImageName,
	parseUploadthingStorageUrl,
	proxiedUploadthingImageUrl,
	uploadthingFileUrl
} from './uploadthing-images';

describe('uploadthing image URLs', () => {
	it('extracts the file key from Uploadthing storage URLs', () => {
		expect(parseUploadthingStorageUrl('https://app-id.ufs.sh/f/file_key-123')).toEqual({
			fileKey: 'file_key-123'
		});
		expect(parseUploadthingStorageUrl('https://example.com/f/file_key-123')).toBeNull();
		expect(parseUploadthingStorageUrl('https://app-id.ufs.sh/not-file_key-123')).toBeNull();
	});

	it('builds and parses proxied image URLs with canonical extensions', () => {
		const extension = imageExtensionFromMime('image/jpeg');
		if (extension === null) throw new Error('Expected jpeg to map to a URL extension');

		expect(extension).toBe('jpg');
		expect(
			proxiedUploadthingImageUrl('https://cadbos.example/api/uploads', 'file.key', extension)
		).toBe('https://cadbos.example/img/file.key.jpg');
		expect(parseProxyImageName('file.key.jpg')).toEqual({
			fileKey: 'file.key',
			extension: 'jpg'
		});
	});

	it('checks image MIME type and extension compatibility', () => {
		expect(imageMimeMatchesExtension('image/jpeg; charset=binary', 'jpg')).toBe(true);
		expect(imageMimeMatchesExtension('image/jpeg', 'jpeg')).toBe(true);
		expect(imageMimeMatchesExtension('image/png', 'jpg')).toBe(false);
	});

	it('builds the upstream Uploadthing file URL from app id and file key', () => {
		expect(uploadthingFileUrl('app-id', 'file_key-123')).toBe(
			'https://app-id.ufs.sh/f/file_key-123'
		);
		expect(uploadthingFileUrl('app/id', 'file_key-123')).toBeNull();
		expect(uploadthingFileUrl('app-id', '../file')).toBeNull();
	});
});
