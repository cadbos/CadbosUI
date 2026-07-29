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

INSERT INTO packages (
	id,
	usd_amount,
	credits_awarded,
	archai_tokens_awarded,
	enabled,
	created_at
)
VALUES
	('pkg-1', 1, 3, 3, 1, unixepoch() * 1000),
	('pkg-3', 3, 9, 9, 1, unixepoch() * 1000),
	('pkg-5', 5, 15, 15, 1, unixepoch() * 1000);
