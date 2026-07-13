import { describe, expect, it, vi } from 'vitest';
import { LaunchdPrinter } from './LaunchdPrinter.js';

describe('LaunchdPrinter', () => {
	it('prints launchd plist with escaped paths and extra arguments', () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

		LaunchdPrinter.printPlist({
			label: 'com.namefix.test&demo',
			binPath: '/Applications/Namefix <Beta>/namefix',
			watchDir: '/Users/me/Desktop/Screenshots & Clips',
			args: ['--include', 'Screen "Shot"*', "--exclude=Bob's"],
		});

		const output = String(write.mock.calls[0]?.[0] ?? '');
		expect(output).toContain('<string>com.namefix.test&amp;demo</string>');
		expect(output).toContain('<string>/Applications/Namefix &lt;Beta&gt;/namefix</string>');
		expect(output).toContain('<string>/Users/me/Desktop/Screenshots &amp; Clips</string>');
		expect(output).toContain('<string>Screen &quot;Shot&quot;*</string>');
		expect(output).toContain('<string>--exclude=Bob&apos;s</string>');
		expect(output).toContain('<key>RunAtLoad</key>');
		expect(output.endsWith('\n')).toBe(true);

		write.mockRestore();
	});

	it('uses the default label and no extra args when optional values are omitted', () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

		LaunchdPrinter.printPlist({
			binPath: '/usr/local/bin/namefix',
			watchDir: '/Users/me/Desktop',
		});

		const output = String(write.mock.calls[0]?.[0] ?? '');
		expect(output).toContain('<string>com.namefix.app</string>');
		expect(output).toContain('<string>/usr/local/bin/namefix</string>');
		expect(output).toContain('<string>--live</string>');
		expect(output).not.toContain('--include');

		write.mockRestore();
	});
});
