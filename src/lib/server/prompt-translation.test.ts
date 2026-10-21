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
import type { Ai, D1Database } from '@cloudflare/workers-types';
import { createDb } from '$lib/server/db';
import { matchPromptGlossary } from '$lib/server/prompt-glossary';
import { translateCreatePrompt } from '$lib/server/prompt-translation';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { getWorkersAiDailyUsage, WORKERS_AI_MODEL } from '$lib/server/workers-ai';

const RUSSIAN_PROMPT = 'Гостиная, пол — паркет французская ёлка из дуба';

function completion(content: string, neurons = 1.25): unknown {
	return { choices: [{ message: { content } }], usage: { neurons } };
}

function platformWith(run: ReturnType<typeof vi.fn>, db: D1Database = makeD1()): App.Platform {
	return { env: { DB: db, AI: { run } as unknown as Ai } } as unknown as App.Platform;
}

function userMessage(run: ReturnType<typeof vi.fn>): string {
	const [, inputs] = run.mock.calls[0] as [string, { messages: { content: string }[] }];
	return inputs.messages[1].content;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('matchPromptGlossary', () => {
	it('matches inflected forms and ё written as е', () => {
		expect(matchPromptGlossary('пол из паркета французской елкой').map(({ term }) => term)).toEqual(
			['французская ёлка']
		);
	});

	it('picks the specific parquet pattern over the generic one', () => {
		expect(matchPromptGlossary('паркет английская ёлка').map(({ term }) => term)).toEqual([
			'английская ёлка'
		]);
	});

	it('leaves a Christmas tree alone', () => {
		expect(matchPromptGlossary('в углу стоит новогодняя ёлка')).toEqual([]);
	});

	it.each([
		'на стенке висит картина',
		'акриловая картина над камином',
		'на полу шкура тюленя',
		'фасад дома из кирпича'
	])('leaves everyday wording alone: %s', (prompt) => {
		expect(matchPromptGlossary(prompt)).toEqual([]);
	});

	it('maps the acrylic stone countertop in both common cases', () => {
		expect(matchPromptGlossary('столешница акриловый камень').map(({ term }) => term)).toEqual([
			'акриловый камень'
		]);
		expect(matchPromptGlossary('столешница из акрилового камня').map(({ term }) => term)).toEqual([
			'акрилового камня'
		]);
	});

	it('tells enamel cabinet fronts apart from plain kitchen fronts', () => {
		expect(matchPromptGlossary('кухня, фасады эмаль').map(({ term }) => term)).toEqual([
			'фасады эмаль'
		]);
		expect(matchPromptGlossary('кухня, фасады из ЛДСП').map(({ term }) => term)).toEqual([
			'кухонные фасады',
			'ЛДСП'
		]);
	});

	it('maps Versailles only when it names a parquet', () => {
		expect(matchPromptGlossary('гостиная в стиле Версаль')).toEqual([]);
		expect(matchPromptGlossary('пол — паркет Версаль').map(({ term }) => term)).toEqual([
			'паркет Версаль'
		]);
	});
});

describe('translateCreatePrompt', () => {
	it('sends a prompt with no Cyrillic as is, without calling Workers AI', async () => {
		const run = vi.fn();

		expect(await translateCreatePrompt(platformWith(run), 'Cozy living room')).toBe(
			'Cozy living room'
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('translates with the matched glossary wording and records the Neurons used', async () => {
		const db = makeD1();
		const run = vi.fn(async () =>
			completion('Living room, floor of oak chevron parquet, planks with angled ends', 1.25)
		);

		const translated = await translateCreatePrompt(platformWith(run, db), RUSSIAN_PROMPT);

		expect(translated).toBe('Living room, floor of oak chevron parquet, planks with angled ends');
		expect(run).toHaveBeenCalledWith(WORKERS_AI_MODEL, expect.objectContaining({ temperature: 0 }));
		expect(userMessage(run)).toContain(
			'французская ёлка = chevron parquet, planks with angled ends meeting in a continuous V point'
		);
		expect(userMessage(run)).toContain(RUSSIAN_PROMPT);
		expect(await getWorkersAiDailyUsage(createDb(db))).toMatchObject({
			requests: 1,
			neurons: 1.25,
			neuronLimit: 10_000
		});
	});

	it('strips reasoning tags and wrapping quotes from the model output', async () => {
		const run = vi.fn(async () => completion('<think>\n</think>\n\n"Bedroom, beige carpet"'));

		expect(await translateCreatePrompt(platformWith(run), 'Спальня, бежевый ковролин')).toBe(
			'Bedroom, beige carpet'
		);
	});

	it.each([
		['empty', ''],
		['cyrillic', 'Living room, паркет'],
		['too_long', 'word '.repeat(400)]
	])('falls back to the original prompt when the translation is %s', async (reason, output) => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const run = vi.fn(async () => completion(output));

		expect(await translateCreatePrompt(platformWith(run), RUSSIAN_PROMPT)).toBe(RUSSIAN_PROMPT);
		expect(errorLog).toHaveBeenCalledWith(
			JSON.stringify({ event: 'prompt_translation_rejected', reason })
		);
	});

	it('falls back to the original prompt and logs no user text when Workers AI fails', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const run = vi.fn(async () => {
			throw new TypeError('network down');
		});

		expect(await translateCreatePrompt(platformWith(run), RUSSIAN_PROMPT)).toBe(RUSSIAN_PROMPT);
		expect(errorLog).toHaveBeenCalledWith(
			JSON.stringify({ event: 'prompt_translation_failed', error: 'TypeError' })
		);
		expect(JSON.stringify(errorLog.mock.calls)).not.toContain('паркет');
	});

	it('gives up on a translation that takes longer than ten seconds', async () => {
		vi.useFakeTimers();
		try {
			const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			const run = vi.fn(() => new Promise(() => undefined));

			const translation = translateCreatePrompt(platformWith(run), RUSSIAN_PROMPT);
			await vi.advanceTimersByTimeAsync(10_000);

			expect(await translation).toBe(RUSSIAN_PROMPT);
			expect(errorLog).toHaveBeenCalledWith(
				JSON.stringify({ event: 'prompt_translation_failed', error: 'timeout' })
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('falls back to the original prompt when the Workers AI binding is missing', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const platform = { env: { DB: makeD1() } } as unknown as App.Platform;

		expect(await translateCreatePrompt(platform, RUSSIAN_PROMPT)).toBe(RUSSIAN_PROMPT);
		expect(errorLog).toHaveBeenCalledWith(
			JSON.stringify({ event: 'prompt_translation_failed', error: 'unconfigured' })
		);
	});

	it('still records the call when Workers AI returns an unexpected shape', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const db = makeD1();
		const run = vi.fn(async () => ({ response: 'Living room' }));

		expect(await translateCreatePrompt(platformWith(run, db), RUSSIAN_PROMPT)).toBe(RUSSIAN_PROMPT);
		expect(warning).toHaveBeenCalledWith(JSON.stringify({ event: 'workers_ai_usage_missing' }));
		expect(await getWorkersAiDailyUsage(createDb(db))).toMatchObject({ requests: 1, neurons: 0 });
	});
});

describe('getWorkersAiDailyUsage', () => {
	it('sums every call of the current UTC day', async () => {
		const db = makeD1();
		const run = vi.fn(async () => completion('Bedroom', 0.5));
		const platform = platformWith(run, db);

		await translateCreatePrompt(platform, 'Спальня');
		await translateCreatePrompt(platform, 'Спальня');

		expect(await getWorkersAiDailyUsage(createDb(db))).toEqual({
			date: new Date().toISOString().slice(0, 10),
			requests: 2,
			neurons: 1,
			neuronLimit: 10_000
		});
	});

	it('reports zero usage before the first call of the day', async () => {
		expect(await getWorkersAiDailyUsage(createDb(makeD1()))).toMatchObject({
			requests: 0,
			neurons: 0
		});
	});
});
