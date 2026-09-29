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

import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);
const MIGRATION = '0020_media_size.sql';

function readMigration(file: string): string {
	return readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8');
}

function migrationFiles(): string[] {
	return readdirSync(MIGRATIONS_DIR)
		.filter((name) => name.endsWith('.sql'))
		.sort();
}

function makeDatabaseBeforeMigration(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	for (const file of migrationFiles()) {
		if (file === MIGRATION) break;
		db.exec(readMigration(file));
	}
	return db;
}

describe('0020 media size migration', () => {
	it('keeps existing media with an unknown size instead of a fabricated zero', () => {
		const db = makeDatabaseBeforeMigration();
		db.prepare(
			"INSERT INTO buckets (name, url) VALUES ('uploads', 'https://uploads.example.test')"
		).run();
		const bucket = db.prepare("SELECT id FROM buckets WHERE name = 'uploads'").get() as {
			id: number;
		};
		db.prepare("INSERT INTO media (filename, bucket, checksum) VALUES ('legacy.webp', ?, '')").run(
			bucket.id
		);

		db.exec(readMigration(MIGRATION));

		expect(db.prepare('SELECT filename, size FROM media').all()).toEqual([
			{ filename: 'legacy.webp', size: null }
		]);
	});

	it('stores a size, allows an empty file, and rejects a negative size', () => {
		const db = makeDatabaseBeforeMigration();
		db.exec(readMigration(MIGRATION));
		db.prepare(
			"INSERT INTO buckets (name, url) VALUES ('uploads', 'https://uploads.example.test')"
		).run();
		const bucket = db.prepare("SELECT id FROM buckets WHERE name = 'uploads'").get() as {
			id: number;
		};
		const insert = db.prepare(
			"INSERT INTO media (filename, bucket, checksum, size) VALUES (?, ?, '', ?)"
		);

		insert.run('sized.webp', bucket.id, 342_000);
		insert.run('empty.webp', bucket.id, 0);

		expect(() => insert.run('negative.webp', bucket.id, -1)).toThrow();
		expect(db.prepare('SELECT filename, size FROM media ORDER BY filename').all()).toEqual([
			{ filename: 'empty.webp', size: 0 },
			{ filename: 'sized.webp', size: 342_000 }
		]);
	});
});
