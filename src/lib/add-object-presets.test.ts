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

import { mentionsPeople } from '$lib/add-object-presets';
import { en } from '$lib/i18n/locales/en';
import { ru } from '$lib/i18n/locales/ru';

describe('mentionsPeople', () => {
	it('recognises both people presets in every locale', () => {
		for (const locale of [ru, en]) {
			for (const phrase of [
				locale['edit.addObject.people.phrase'],
				locale['edit.addObject.peopleMotion.phrase']
			]) {
				expect(mentionsPeople(phrase)).toBe(true);
			}
		}
	});

	it.each([
		'мужчину, читающего на диване',
		'женщину у кухонного острова',
		'ребёнка, играющего на ковре',
		'семью за обеденным столом',
		'a woman sitting by the window',
		'children playing on the rug'
	])('recognises people in a typed instruction: %s', (instruction) => {
		expect(mentionsPeople(instruction)).toBe(true);
	});

	it.each(['серое кресло у окна', 'детскую кроватку у стены', 'a mirror above the console'])(
		'finds no people in an object instruction: %s',
		(instruction) => {
			expect(mentionsPeople(instruction)).toBe(false);
		}
	);
});
