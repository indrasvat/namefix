import { describe, expect, it } from 'vitest';
import type { IProfile } from '../../types/index.js';
import { Matcher, ProfileMatcher } from './Matcher.js';

const profile = (overrides: Partial<IProfile>): IProfile => ({
	id: overrides.id ?? 'profile',
	name: overrides.name ?? 'Profile',
	enabled: overrides.enabled ?? true,
	pattern: overrides.pattern ?? '*',
	isRegex: overrides.isRegex ?? false,
	template: overrides.template ?? '<prefix>_<datetime>',
	prefix: overrides.prefix ?? 'Screenshot',
	priority: overrides.priority ?? 1,
	action: overrides.action,
});

describe('Matcher', () => {
	it('matches includes case-insensitively and applies excludes after includes', () => {
		const matcher = new Matcher(['Screenshot*.PNG'], ['*draft*']);

		expect(matcher.test('screenshot 2026.PNG')).toBe(true);
		expect(matcher.test('Screenshot draft.PNG')).toBe(false);
		expect(matcher.test('.Screenshot.PNG')).toBe(false);
		expect(matcher.test('Recording.mov')).toBe(false);
	});
});

describe('ProfileMatcher', () => {
	it('returns the highest-priority enabled profile that matches', () => {
		const profiles = [
			profile({ id: 'low', pattern: 'Screenshot*', priority: 10 }),
			profile({ id: 'disabled', pattern: 'Screenshot*', priority: 0, enabled: false }),
			profile({ id: 'high', pattern: 'Screenshot 2026*', priority: 1 }),
		];

		const matcher = new ProfileMatcher(profiles);

		expect(matcher.match('Screenshot 2026-07-13.png')?.id).toBe('high');
		expect(matcher.getProfiles().map((p) => p.id)).toEqual(['high', 'low']);
	});

	it('supports regex profiles and skips invalid regex patterns', () => {
		const matcher = new ProfileMatcher([
			profile({ id: 'invalid', pattern: '[', isRegex: true, priority: 0 }),
			profile({
				id: 'recording',
				pattern: '^Screen Recording.*\\.mov$',
				isRegex: true,
				priority: 1,
			}),
		]);

		expect(matcher.match('Screen Recording 2026-07-13.mov')?.id).toBe('recording');
		expect(matcher.test('Screenshot.png')).toBe(false);
		expect(matcher.match('.Screen Recording.mov')).toBeNull();
	});
});
