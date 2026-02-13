import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export type ConvertOptions = {
	outputFormat: 'jpeg' | 'png' | 'tiff' | 'heic';
	outputDir?: string;
	quality?: number;
};

export type ConvertResult = {
	srcPath: string;
	destPath: string;
	format: string;
	durationMs: number;
};

const SUPPORTED_INPUTS = new Set([
	'.heic',
	'.heif',
	'.png',
	'.jpg',
	'.jpeg',
	'.tiff',
	'.bmp',
	'.gif',
]);

export class ConversionService {
	canConvert(ext: string): boolean {
		return SUPPORTED_INPUTS.has(ext.toLowerCase());
	}

	async convert(srcPath: string, opts: ConvertOptions): Promise<ConvertResult> {
		const start = Date.now();
		const dir = opts.outputDir ?? path.dirname(srcPath);
		const baseName = path.basename(srcPath, path.extname(srcPath));
		const targetExt = `.${opts.outputFormat}`;
		const destPath = await this.reserveTarget(dir, `${baseName}${targetExt}`);

		const quality = opts.outputFormat === 'jpeg' ? (opts.quality ?? 90) : undefined;

		const args = ['--setProperty', 'format', opts.outputFormat];
		if (quality !== undefined) {
			args.push('--setProperty', 'formatOptions', String(quality));
		}
		args.push(srcPath, '--out', destPath);

		const { stderr } = await execFile('sips', args);
		// sips prints warnings to stderr even on success — only fail on actual errors
		// The promisified execFile already throws on non-zero exit code
		void stderr;

		return {
			srcPath,
			destPath,
			format: opts.outputFormat,
			durationMs: Date.now() - start,
		};
	}

	private async reserveTarget(dir: string, base: string): Promise<string> {
		const ext = path.extname(base);
		const name = base.slice(0, -ext.length);
		let candidate = path.join(dir, base);
		let n = 2;
		while (await exists(candidate)) {
			candidate = path.join(dir, `${name}_${n}${ext}`);
			n++;
		}
		return candidate;
	}
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}
