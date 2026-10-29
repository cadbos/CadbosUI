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

import { describe, expect, it } from 'vitest';
import type { UserUsageRecord } from '$lib/api/contract';
import { buildUserUsageMarkdown, type UserUsageMarkdownInput } from './user-usage-markdown';

const NPUB = 'npub1example';
const DAY_START = new Date(2026, 0, 3).getTime();
const AT_NOON = new Date(2026, 0, 3, 12, 0, 5).getTime();

const RECORD: UserUsageRecord = {
	pubkey: 'c'.repeat(64),
	balance: 1234.5,
	totalDeposit: 100,
	lastDepositAt: null,
	projectCount: 3,
	sessionCount: 4,
	generationCount: 5,
	sourceCount: 1,
	sourceBytes: 3 * 1024 * 1024,
	referenceCount: 0,
	referenceBytes: null,
	totalSpend: 57.5,
	latestSpendAt: AT_NOON
};

function input(overrides: Partial<UserUsageMarkdownInput> = {}): UserUsageMarkdownInput {
	return {
		npub: NPUB,
		dayStart: null,
		record: RECORD,
		generationKinds: [
			{ kind: 'render', count: 4 },
			{ kind: 'style-transfer', count: 1 }
		],
		generations: null,
		origin: 'https://cadbos.example',
		...overrides
	};
}

describe('buildUserUsageMarkdown', () => {
	it("exports the user's all-time figures and generation types without generations", () => {
		const markdown = buildUserUsageMarkdown(input());

		expect(markdown).toBe(
			[
				'# Использование пользователя npub1example',
				'',
				'Статистика одного пользователя Cadbos за всё время.',
				'',
				'## Сводка',
				'',
				'| Показатель | Значение |',
				'| --- | ---: |',
				'| Баланс | $ 1,234.50 |',
				'| Всего пополнено | $ 100.00 |',
				'| Всего потрачено | $ 57.50 |',
				'| Проекты | 3 |',
				'| Сессии | 4 |',
				'| Генерации | 5 |',
				'| Загруженные исходники | 1 \\| 3 МБ |',
				'| Загруженные референсы | 0 \\| — |',
				'| Последнее пополнение | — |',
				'| Последняя трата | 3 янв. 2026 г., 12:00 |',
				'',
				'## Типы генераций',
				'',
				'| Тип | Количество |',
				'| --- | ---: |',
				'| Создание | 4 |',
				'| Миграция стиля | 1 |',
				''
			].join('\n')
		);
	});

	it("lists the day's generations with escaped prompts and absolute image links", () => {
		const markdown = buildUserUsageMarkdown(
			input({
				dayStart: DAY_START,
				generations: [
					{
						id: 'generation-1',
						kind: 'style-transfer',
						createdAt: AT_NOON,
						prompt: 'a | b\nwith <b>bold</b>',
						source: { key: 'uploads/source.webp', url: '/api/media/uploads/source.webp' },
						result: { key: 'uploads/result.webp', url: '/api/media/uploads/result.webp' },
						reference: null
					}
				]
			})
		);

		expect(markdown).toContain('Статистика пользователя за 3 января 2026 г.');
		expect(markdown).toContain(
			'| ID | Время | Тип генерации | Промпт | Исходное | Результат | Референс |'
		);
		expect(markdown).toContain(
			'| generation-1 | 12:00:05 | Миграция стиля | a \\| b<br>with &lt;b>bold&lt;/b> | ' +
				'![Исходное изображение генерации generation-1](https://cadbos.example/api/media/uploads/source.webp) | ' +
				'![Результат генерации generation-1](https://cadbos.example/api/media/uploads/result.webp) | — |'
		);
	});

	it('says so when the day had no generations or no kinds', () => {
		const markdown = buildUserUsageMarkdown(
			input({ dayStart: DAY_START, generationKinds: [], generations: [] })
		);

		expect(markdown).toContain('## Типы генераций\n\nГенераций нет.');
		expect(markdown).toContain('## Генерации за день\n\nЗа этот день генераций нет.\n');
	});
});
