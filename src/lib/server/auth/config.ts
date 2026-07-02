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

export const NIP98_KIND = 27235;

export const CHALLENGE_TTL_MS = 60_000;

export const EVENT_TIME_WINDOW_MS = 60_000;

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'cadbos_session';

export const AUTH_RATE_LIMIT = { windowMs: 60_000, max: 20 } as const;
