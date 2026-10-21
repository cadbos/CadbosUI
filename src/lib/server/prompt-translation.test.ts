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
import type { Ai } from '@cloudflare/workers-types';
import { matchPromptGlossary } from '$lib/server/prompt-glossary';
import { translateCreatePrompt } from '$lib/server/prompt-translation';
import { WORKERS_AI_MODEL } from '$lib/server/workers-ai';

const RUSSIAN_PROMPT = 'Гостиная, пол — паркет французская ёлка из дуба';

function completion(content: string): unknown {
	return { choices: [{ message: { content } }], usage: { neurons: 1.25 } };
}

function platformWith(run: ReturnType<typeof vi.fn>): App.Platform {
	return { env: { AI: { run } as unknown as Ai } } as unknown as App.Platform;
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
	it('leaves a prompt with no Cyrillic untranslated, without calling Workers AI', async () => {
		const run = vi.fn();

		expect(await translateCreatePrompt(platformWith(run), 'Cozy living room')).toBeNull();
		expect(run).not.toHaveBeenCalled();
	});

	it('translates with the matched glossary wording', async () => {
		const run = vi.fn(async () =>
			completion('Living room, floor of oak chevron parquet, planks with angled ends')
		);

		const translated = await translateCreatePrompt(platformWith(run), RUSSIAN_PROMPT);

		expect(translated).toBe('Living room, floor of oak chevron parquet, planks with angled ends');
		expect(run).toHaveBeenCalledWith(WORKERS_AI_MODEL, expect.objectContaining({ temperature: 0 }));
		expect(userMessage(run)).toContain(
			'французская ёлка = chevron parquet, planks with angled ends meeting in a continuous V point'
		);
		expect(userMessage(run)).toContain(RUSSIAN_PROMPT);
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
	])('reports no translation when the output is %s', async (reason, output) => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const run = vi.fn(async () => completion(output));

		expect(await translateCreatePrompt(platformWith(run), RUSSIAN_PROMPT)).toBeNull();
		expect(errorLog).toHaveBeenCalledWith(
			JSON.stringify({ event: 'prompt_translation_rejected', reason })
		);
	});

	it('reports no translation and logs no user text when Workers AI fails', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const run = vi.fn(async () => {
			throw new TypeError('network down');
		});

		expect(await translateCreatePrompt(platformWith(run), RUSSIAN_PROMPT)).toBeNull();
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

			expect(await translation).toBeNull();
			expect(errorLog).toHaveBeenCalledWith(
				JSON.stringify({ event: 'prompt_translation_failed', error: 'timeout' })
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('reports no translation when the Workers AI binding is missing', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const platform = { env: {} } as unknown as App.Platform;

		expect(await translateCreatePrompt(platform, RUSSIAN_PROMPT)).toBeNull();
		expect(errorLog).toHaveBeenCalledWith(
			JSON.stringify({ event: 'prompt_translation_failed', error: 'unconfigured' })
		);
	});

	it('reports no translation when Workers AI returns an unexpected shape', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const run = vi.fn(async () => ({ response: 'Living room' }));

		expect(await translateCreatePrompt(platformWith(run), RUSSIAN_PROMPT)).toBeNull();
		expect(errorLog).toHaveBeenCalledWith(
			JSON.stringify({ event: 'prompt_translation_failed', error: 'response' })
		);
	});
});
