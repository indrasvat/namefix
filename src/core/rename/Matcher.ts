import picomatch from 'picomatch';
import type { IProfile } from '../../types/index.js';

export class Matcher {
	private includeMatchers: ((s: string) => boolean)[];
	private excludeMatchers: ((s: string) => boolean)[];

	constructor(includes: string[], excludes: string[] = []) {
		const incGlobs = includes?.length ? includes : ['*'];
		this.includeMatchers = incGlobs.map((g) => picomatch(g, { dot: false, nocase: true }));
		this.excludeMatchers = (excludes ?? []).map((g) => picomatch(g, { dot: false, nocase: true }));
	}

	test(basename: string): boolean {
		if (!basename || basename.startsWith('.')) return false; // ignore dotfiles
		const inc = this.includeMatchers.some((m) => m(basename));
		if (!inc) return false;
		const exc = this.excludeMatchers.some((m) => m(basename));
		return !exc;
	}
}

/**
 * Matches filenames against profiles and returns the first matching profile.
 * Profiles are sorted by priority (lower = higher priority).
 */
export class ProfileMatcher {
	private matchers: Array<{
		profile: IProfile;
		test: (s: string) => boolean;
	}> = [];

	constructor(profiles: IProfile[]) {
		// Sort by priority (lower = higher priority)
		const sorted = [...profiles].filter((p) => p.enabled).sort((a, b) => a.priority - b.priority);

		for (const profile of sorted) {
			let test: (s: string) => boolean;

			if (profile.isRegex) {
				// Use regex matching
				try {
					const regex = new RegExp(profile.pattern);
					test = (s: string) => regex.test(s);
				} catch {
					// Invalid regex, skip this profile
					continue;
				}
			} else {
				// Use glob matching
				test = picomatch(profile.pattern, { dot: false, nocase: true });
			}

			this.matchers.push({ profile, test });
		}
	}

	/**
	 * Find the first matching profile for a given basename.
	 * Returns null if no profile matches.
	 */
	match(basename: string): IProfile | null {
		if (!basename || basename.startsWith('.')) return null; // ignore dotfiles

		for (const { profile, test } of this.matchers) {
			if (test(basename)) {
				return profile;
			}
		}

		return null;
	}

	/**
	 * Test if any profile matches the basename.
	 */
	test(basename: string): boolean {
		return this.match(basename) !== null;
	}

	/**
	 * Get all enabled profiles in priority order.
	 */
	getProfiles(): IProfile[] {
		return this.matchers.map((m) => m.profile);
	}
}
