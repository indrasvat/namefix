export type Theme = {
	name: string;
	fg: string;
	bg: string;
	accent: string;
	dim: string;
	ok: string;
	warn: string;
	err: string;
};

export const THEMES: Record<string, Theme> = {
	default: {
		name: 'default',
		fg: 'white',
		bg: 'black',
		accent: 'cyan',
		dim: 'gray',
		ok: 'green',
		warn: 'yellow',
		err: 'red',
	},
	neon: {
		name: 'neon',
		fg: 'white',
		bg: 'black',
		accent: 'magenta',
		dim: 'gray',
		ok: 'lime',
		warn: 'yellow',
		err: 'red',
	},
	'solarized-dark': {
		name: 'solarized-dark',
		fg: '#93a1a1',
		bg: '#002b36',
		accent: '#268bd2',
		dim: '#586e75',
		ok: '#2aa198',
		warn: '#b58900',
		err: '#dc322f',
	},
	pro: {
		name: 'pro',
		fg: '#e5e5e5',
		bg: '#1e1e1e',
		accent: '#569cd6',
		dim: '#6a6a6a',
		ok: '#4ec9b0',
		warn: '#dcdcaa',
		err: '#f44747',
	},
};

export class ThemeManager {
	private theme: Theme;
	private listeners = new Set<(t: Theme) => void>();

	constructor() {
		this.theme = THEMES.default as Theme;
	}

	get(): Theme {
		return this.theme as Theme;
	}

	names(): string[] {
		return Object.keys(THEMES);
	}

	set(name: string) {
		const next = ((THEMES as Record<string, Theme>)[name] ?? THEMES.default) as Theme;
		this.theme = next as Theme;
		for (const l of this.listeners) l(next as Theme);
	}

	onChange(cb: (t: Theme) => void) {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}
}
