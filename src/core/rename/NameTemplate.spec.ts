import { describe, expect, it } from 'vitest';
import {
	applyTemplate,
	buildName,
	buildNameFromTemplate,
	formatTimestamp,
	generateProfileId,
	getBasename,
	getExt,
	sanitizePrefix,
} from './NameTemplate.js';

const context = {
	originalPath: '/Users/me/Desktop/Screen Shot Final.PNG',
	birthtime: new Date(2026, 6, 13, 9, 8, 7),
	ext: 'PNG',
	prefix: 'Client Capture',
	counter: 12,
};

describe('NameTemplate', () => {
	it('formats legacy names with sanitized prefixes and lowercase extensions', () => {
		const when = new Date(2026, 6, 13, 9, 8, 7);

		expect(formatTimestamp(when)).toBe('2026-07-13_09-08-07');
		expect(sanitizePrefix('  Client   Capture  ')).toBe('Client_Capture');
		expect(buildName('  Client   Capture  ', when, 'PNG')).toBe(
			'Client_Capture_2026-07-13_09-08-07.png',
		);
	});

	it('expands date, counter, extension, and transform variables', () => {
		const result = applyTemplate(
			'<slug:prefix>/<date>/<upper:original>_<counter:4><ext>_<unknown>',
			context,
		);

		expect(result).toBe('client-capture/2026-07-13/SCREEN SHOT FINAL_0012.png_<unknown>');
	});

	it('appends extension only when the template does not include ext', () => {
		expect(buildNameFromTemplate('<prefix>_<datetime>', context)).toBe(
			'Client_Capture_2026-07-13_09-08-07.png',
		);
		expect(buildNameFromTemplate('<lower:original><ext>', context)).toBe('screen shot final.png');
	});

	it('handles paths without extensions and generates stable profile id prefixes', () => {
		expect(getBasename('/tmp/archive')).toBe('archive');
		expect(getExt('/tmp/archive')).toBe('');
		expect(generateProfileId()).toMatch(
			/^profile-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});
});
