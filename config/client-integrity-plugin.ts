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

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

export const CLIENT_INTEGRITY_MANIFEST_PATH = '_app/client-integrity.json';

interface IntegrityOutput {
	fileName: string;
	contents: string | Uint8Array;
}

export function createClientIntegrityManifest(
	outputs: readonly IntegrityOutput[]
): Record<string, string> {
	const manifest: Record<string, string> = {};

	for (const output of [...outputs].sort((left, right) =>
		left.fileName.localeCompare(right.fileName)
	)) {
		if (!output.fileName.endsWith('.js') && !output.fileName.endsWith('.css')) continue;

		const integrity = createHash('sha384').update(output.contents).digest('base64');
		manifest[`/${output.fileName}`] = `sha384-${integrity}`;
	}

	return manifest;
}

export function clientIntegrityPlugin(): Plugin {
	return {
		name: 'cadbos-client-integrity',
		apply: 'build',
		enforce: 'post',
		applyToEnvironment: (environment) => environment.config.consumer === 'client',
		async writeBundle(options, bundle) {
			const files = Object.values(bundle).filter(
				(output) => output.fileName.endsWith('.js') || output.fileName.endsWith('.css')
			);
			if (files.length === 0) return;
			const outputDirectory = options.dir;
			if (!outputDirectory) throw new Error('Client integrity build requires an output directory');

			const outputs = await Promise.all(
				files.map(async ({ fileName }) => ({
					fileName,
					contents: await readFile(resolve(outputDirectory, fileName))
				}))
			);
			const manifestPath = resolve(outputDirectory, CLIENT_INTEGRITY_MANIFEST_PATH);
			await mkdir(dirname(manifestPath), { recursive: true });
			await writeFile(manifestPath, JSON.stringify(createClientIntegrityManifest(outputs)));
		}
	};
}
