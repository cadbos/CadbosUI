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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRevealTimers, REVEAL_ON_TIMEOUT_MS, revealOnTimeout } from './reveal-on-timeout';

afterEach(() => {
	vi.useRealTimers();
});

describe('revealOnTimeout', () => {
	it('reveals when the delay elapses and skips the callback if cancelled first', () => {
		vi.useFakeTimers();
		const reveal = vi.fn();
		const cancel = revealOnTimeout(reveal);

		vi.advanceTimersByTime(REVEAL_ON_TIMEOUT_MS - 1);
		expect(reveal).not.toHaveBeenCalled();

		cancel();
		vi.advanceTimersByTime(1);
		expect(reveal).not.toHaveBeenCalled();

		revealOnTimeout(reveal);
		vi.advanceTimersByTime(REVEAL_ON_TIMEOUT_MS);
		expect(reveal).toHaveBeenCalledOnce();
	});

	it('keeps an armed timer when the same id is retained and cancels ids that drop out', () => {
		vi.useFakeTimers();
		const timers = createRevealTimers(REVEAL_ON_TIMEOUT_MS);
		const reveal = vi.fn();

		timers.retain(['a', 'b'], reveal);
		timers.retain(['a'], reveal);
		vi.advanceTimersByTime(REVEAL_ON_TIMEOUT_MS);

		expect(reveal).toHaveBeenCalledTimes(1);
		expect(reveal).toHaveBeenCalledWith('a');
	});
});
