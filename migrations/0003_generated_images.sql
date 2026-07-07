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

CREATE TABLE generated_images (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	url TEXT NOT NULL CHECK (url LIKE 'http://%' OR url LIKE 'https://%'),
	created_at INTEGER NOT NULL
);

CREATE INDEX generated_images_user_created_at ON generated_images (user_id, created_at DESC);
