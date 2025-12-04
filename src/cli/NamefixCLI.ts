export class NamefixCLI {
	run(argv: string[] = process.argv.slice(2)) {
		if (argv.includes('--version') || argv.includes('-v')) {
			// Version is printed by bin/dist stubs. Here we no-op for now.
			return 0;
		}
		// TODO: Implement commander-based CLI (Task 14)
		return 0;
	}
}
