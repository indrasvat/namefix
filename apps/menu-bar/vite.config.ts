import { defineConfig } from 'vite';

export default defineConfig(() => ({
	server: {
		port: 5173,
		strictPort: true,
	},
	clearScreen: false,
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		target: 'es2022',
	},
}));
