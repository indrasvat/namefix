import { describe, expect, test } from 'vitest';
import { applyTemplate, buildNameFromTemplate } from './NameTemplate.js';

const context = {
	originalPath: '/tmp/Screen Shot 2026.png',
	birthtime: new Date(2026, 5, 25, 9, 4, 7),
	ext: 'PNG',
	prefix: 'Work Capture',
};

describe('NameTemplate', () => {
	test('applies date, prefix, and transform variables', () => {
		expect(applyTemplate('<slug:prefix>_<datetime>_<upper:ext>', context)).toBe(
			'work-capture_2026-06-25_09-04-07_.PNG',
		);
	});

	test('appends a normalized extension when the template omits ext', () => {
		expect(buildNameFromTemplate('<prefix>_<counter:2>', context)).toBe('Work_Capture_01.png');
	});

	test('does not append a duplicate extension when the template includes ext', () => {
		expect(buildNameFromTemplate('<lower:original><ext>', context)).toBe('screen shot 2026.png');
	});
});
