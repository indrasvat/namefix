import path from 'node:path';

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

function pad(n: number, digits: number): string {
	return String(n).padStart(digits, '0');
}

export function formatTimestamp(d: Date): string {
	const yyyy = d.getFullYear();
	const mm = pad2(d.getMonth() + 1);
	const dd = pad2(d.getDate());
	const hh = pad2(d.getHours());
	const mi = pad2(d.getMinutes());
	const ss = pad2(d.getSeconds());
	return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

export function sanitizePrefix(prefix: string): string {
	return prefix.trim().replace(/\s+/g, '_');
}

/**
 * Build a filename using the legacy format: {prefix}_{timestamp}.{ext}
 * Kept for backwards compatibility.
 */
export function buildName(prefix: string, d: Date, ext: string): string {
	const p = sanitizePrefix(prefix || 'Screenshot');
	const ts = formatTimestamp(d);
	const e = ext.startsWith('.') ? ext : `.${ext}`;
	return `${p}_${ts}${e.toLowerCase()}`;
}

export function getExt(p: string): string {
	return path.extname(p) || '';
}

/**
 * Get the base filename without extension.
 */
export function getBasename(p: string): string {
	const ext = path.extname(p);
	const base = path.basename(p);
	return ext ? base.slice(0, -ext.length) : base;
}

/**
 * Context for template variable resolution.
 */
export interface TemplateContext {
	/** Original filename (full path) */
	originalPath: string;
	/** File creation/birth time */
	birthtime: Date;
	/** File extension (with dot) */
	ext: string;
	/** Profile prefix */
	prefix: string;
	/** Counter value for collision resolution */
	counter?: number;
}

/**
 * Available template variables:
 * - <date>       → 2024-12-20
 * - <time>       → 14-35-42
 * - <datetime>   → 2024-12-20_14-35-42
 * - <original>   → Original filename (without extension)
 * - <ext>        → File extension (with dot, e.g., .png)
 * - <counter>    → Sequential number (001, 002...)
 * - <counter:N>  → Zero-padded to N digits
 * - <prefix>     → Profile prefix
 * - <year>       → 2024
 * - <month>      → 12
 * - <day>        → 20
 * - <hour>       → 14
 * - <minute>     → 35
 * - <second>     → 42
 * - <upper:var>  → UPPERCASE version of variable
 * - <lower:var>  → lowercase version of variable
 * - <slug:var>   → kebab-case version of variable
 */
export function applyTemplate(template: string, ctx: TemplateContext): string {
	const d = ctx.birthtime;
	const year = String(d.getFullYear());
	const month = pad2(d.getMonth() + 1);
	const day = pad2(d.getDate());
	const hour = pad2(d.getHours());
	const minute = pad2(d.getMinutes());
	const second = pad2(d.getSeconds());
	const date = `${year}-${month}-${day}`;
	const time = `${hour}-${minute}-${second}`;
	const datetime = `${date}_${time}`;
	const original = getBasename(ctx.originalPath);
	const ext = (ctx.ext.startsWith('.') ? ctx.ext : `.${ctx.ext}`).toLowerCase();
	const prefix = sanitizePrefix(ctx.prefix || 'File');
	const counter = ctx.counter ?? 1;

	// Simple variable map
	const vars: Record<string, string> = {
		date,
		time,
		datetime,
		original,
		ext,
		prefix,
		year,
		month,
		day,
		hour,
		minute,
		second,
		counter: pad(counter, 3),
	};

	// Process template
	let result = template;

	// Handle <counter:N> with custom padding
	result = result.replace(/<counter:(\d+)>/g, (_, digits) => {
		return pad(counter, Number.parseInt(digits, 10));
	});

	// Handle transform modifiers: <upper:var>, <lower:var>, <slug:var>
	result = result.replace(/<(upper|lower|slug):(\w+)>/g, (_, modifier, varName) => {
		const value = vars[varName] ?? '';
		switch (modifier) {
			case 'upper':
				return value.toUpperCase();
			case 'lower':
				return value.toLowerCase();
			case 'slug':
				return toSlug(value);
			default:
				return value;
		}
	});

	// Handle simple variables
	result = result.replace(/<(\w+)>/g, (match, varName) => {
		return vars[varName] ?? match;
	});

	return result;
}

/**
 * Convert a string to kebab-case slug.
 */
function toSlug(s: string): string {
	return s
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/**
 * Build a filename using a template and context.
 * Returns the full filename with extension.
 * If the template contains <ext>, we don't auto-append the extension.
 */
export function buildNameFromTemplate(template: string, ctx: TemplateContext): string {
	const name = applyTemplate(template, ctx);
	// If template explicitly uses <ext>, don't auto-append (it already has the extension)
	if (template.includes('<ext>')) {
		return name;
	}
	const ext = ctx.ext.startsWith('.') ? ctx.ext : `.${ctx.ext}`;
	return `${name}${ext.toLowerCase()}`;
}

/**
 * Default template that matches legacy behavior: <prefix>_<datetime>
 */
export const DEFAULT_TEMPLATE = '<prefix>_<datetime>';

/**
 * Default profiles shipped with Namefix.
 */
export const DEFAULT_PROFILES = [
	{
		id: 'screenshots',
		name: 'Screenshots',
		enabled: true,
		pattern: 'Screenshot*',
		isRegex: false,
		template: '<prefix>_<datetime>',
		prefix: 'Screenshot',
		priority: 1,
	},
	{
		id: 'screen-recordings',
		name: 'Screen Recordings',
		enabled: true,
		pattern: 'Screen Recording*',
		isRegex: false,
		template: '<prefix>_<datetime>',
		prefix: 'Recording',
		priority: 2,
	},
] as const;

/**
 * Generate a unique ID for a new profile.
 */
export function generateProfileId(): string {
	return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
