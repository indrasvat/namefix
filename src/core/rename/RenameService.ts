import fs from 'node:fs/promises';
import path from 'node:path';
import type { IProfile } from '../../types/index.js';
import {
	buildName,
	buildNameFromTemplate,
	getExt,
	DEFAULT_TEMPLATE,
	type TemplateContext,
} from './NameTemplate.js';

export interface RenameTarget {
	/** The target filename (basename only) */
	filename: string;
	/** The profile that was used for renaming, or null if legacy mode */
	profile: IProfile | null;
}

export class RenameService {
	private readonly inFlightTargets = new Set<string>();

	/**
	 * Check if a file needs renaming based on a prefix pattern.
	 * @deprecated Use needsRenameForProfile instead for template-based checking.
	 */
	needsRename(filename: string, prefix: string): boolean {
		const base = path.basename(filename);
		const p = (prefix || 'Screenshot').trim().replace(/\s+/g, '_');
		const re = new RegExp(
			`^${escapeRegExp(p)}_\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}(?:_\\d+)?\\.(png|jpg|jpeg|mov|mp4)$`,
			'i',
		);
		return !re.test(base);
	}

	/**
	 * Check if a file needs renaming based on a profile's template.
	 * For now, we use a simple heuristic: if the filename already matches
	 * the expected output pattern, skip it (idempotent).
	 */
	needsRenameForProfile(filename: string, profile: IProfile): boolean {
		const base = path.basename(filename);
		const prefix = (profile.prefix || 'File').trim().replace(/\s+/g, '_');

		// Check if already matches the pattern: {prefix}_{date}_{time}[_counter].ext
		const re = new RegExp(
			`^${escapeRegExp(prefix)}_\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}(?:_\\d+)?\\.[a-z0-9]+$`,
			'i',
		);
		return !re.test(base);
	}

	/**
	 * Generate target filename using legacy prefix-based naming.
	 * @deprecated Use targetForProfile instead for template-based naming.
	 */
	async targetFor(
		srcPath: string,
		stat: { birthtime: Date; ext?: string; prefix?: string },
	): Promise<string> {
		const dir = path.dirname(srcPath);
		const ext = (stat.ext || getExt(srcPath) || '.png').replace(/^\.+/, '.');
		const base = buildName(stat.prefix || 'Screenshot', stat.birthtime ?? new Date(), ext);
		return await this.reserveTarget(dir, base);
	}

	/**
	 * Generate target filename using a profile's template.
	 */
	async targetForProfile(
		srcPath: string,
		stat: { birthtime: Date; ext?: string },
		profile: IProfile,
	): Promise<RenameTarget> {
		const dir = path.dirname(srcPath);
		const ext = (stat.ext || getExt(srcPath) || '.png').replace(/^\.+/, '.');
		const template = profile.template || DEFAULT_TEMPLATE;

		const ctx: TemplateContext = {
			originalPath: srcPath,
			birthtime: stat.birthtime ?? new Date(),
			ext,
			prefix: profile.prefix || 'File',
		};

		// Build the base name from template
		const baseName = buildNameFromTemplate(template, ctx);
		const reserved = await this.reserveTarget(dir, baseName);

		return {
			filename: reserved,
			profile,
		};
	}

	release(dir: string, target: string): void {
		this.inFlightTargets.delete(fullPath(dir, target));
	}

	private async reserveTarget(dir: string, base: string): Promise<string> {
		const { name, ext } = splitBase(base);
		let candidate = base;
		let n = 2;
		while (true) {
			const key = fullPath(dir, candidate);
			if (this.inFlightTargets.has(key)) {
				candidate = `${name}_${n}${ext}`;
				n++;
				continue;
			}

			this.inFlightTargets.add(key);
			const occupied = await exists(path.join(dir, candidate));
			if (!occupied) return candidate;

			this.inFlightTargets.delete(key);
			candidate = `${name}_${n}${ext}`;
			n++;
		}
	}
}

function splitBase(filename: string): { name: string; ext: string } {
	const ext = path.extname(filename);
	const name = filename.slice(0, -ext.length);
	return { name, ext };
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

function fullPath(dir: string, name: string): string {
	return path.resolve(dir, name);
}
