import {
	runSetup,
	type SetupOptions,
	type SetupReport,
} from '../../server/services/setup.js';

export interface SetupCliOptions {
	argv: string[];
	print: (text: string) => void;
	eprint?: (text: string) => void;
}

const USAGE = `Usage: apple-doc-plugin setup [options]

First-Run Setup & Vector Bootstrap CLI. Verifies database integrity,
detects embedding providers, and guides downloading or creating vectors.

Options:
  --download-vectors, --vectors  Download pre-computed 768-d vector index
  --download-model, --model      Download local EmbeddingGemma GGUF model
  --target <ide>                 Automatically configure IDE (cursor, claude-desktop, windsurf, antigravity)
  --db <path>                    Custom SQLite database path
  --force                        Force re-download of assets
  --dry-run                      Inspect and preview actions without modifying files or downloading
  --strict                       Exit with code 1 if setup is not fully hybrid-ready
  --json                         Output report in machine-readable JSON format
  -h, --help                     Show this help message

Examples:
  apple-doc-plugin setup
  apple-doc-plugin setup --download-vectors --download-model
  apple-doc-plugin setup --target cursor --download-vectors
  apple-doc-plugin setup --target cursor --dry-run
`;

export async function runSetupCli(options: SetupCliOptions): Promise<number> {
	const eprint = options.eprint ?? ((t: string) => process.stderr.write(t));
	const argv = options.argv;

	if (argv.includes('--help') || argv.includes('-h')) {
		options.print(USAGE);
		return 0;
	}

	const downloadVectors =
		argv.includes('--download-vectors') || argv.includes('--vectors');
	const downloadModel =
		argv.includes('--download-model') || argv.includes('--model');
	const force = argv.includes('--force');
	const dryRun = argv.includes('--dry-run');
	const strict = argv.includes('--strict');
	const json = argv.includes('--json');

	const targetIdx = argv.indexOf('--target');
	const target =
		targetIdx !== -1 && targetIdx + 1 < argv.length
			? argv[targetIdx + 1]
			: undefined;

	const dbIdx = argv.indexOf('--db');
	const dbPath =
		dbIdx !== -1 && dbIdx + 1 < argv.length ? argv[dbIdx + 1] : undefined;

	try {
		const report = await runSetup({
			dbPath,
			downloadVectors,
			downloadModel,
			target,
			force,
			dryRun,
		});

		if (json) {
			options.print(`${JSON.stringify(report, null, 2)}\n`);
			if (strict && report.mode !== 'hybrid') {
				return 1;
			}
			return 0;
		}

		const geminiAuthLabel = report.geminiApiKeyConfigured
			? '✔ Configured (API Key)'
			: report.geminiAuthAvailable
				? '✔ Configured (ADC)'
				: '✖ Not configured';

		// Human-readable formatted report
		const lines: string[] = [
			'🍏 Apple Developer Documentation MCP Server — First-Run Setup',
			'===========================================================',
			...(dryRun
				? ['🔍 [Dry Run Preview — No changes written to disk]', '']
				: []),
			'📊 Database & Symbols:',
			`   • Status: ${report.dbExists ? '✔ Found' : '✖ Missing'} (${report.dbPath})`,
			`   • Size: ${report.dbSizeMb} MB`,
			`   • Documented Symbols: ${report.symbolCount.toLocaleString()}`,
			`   • Semantic Vectors: ${report.semanticItemCount.toLocaleString()}`,
			'',
			'🧠 Embedding Provider & Search Mode:',
			`   • Local Model: ${report.localModelExists ? '✔ Installed' : '✖ Not downloaded'} (${report.localModelPath})`,
			...(report.localModelExists
				? [`     Size: ${report.localModelSizeMb} MB`]
				: []),
			`   • Gemini Auth: ${geminiAuthLabel}`,
			`   • Active Provider: ${report.activeProviderId} (${report.activeProviderAvailable ? '✔ Available' : '✖ Unavailable'})`,
			`   • Active Search Mode: ${report.mode === 'hybrid' ? '🚀 Hybrid (FTS5 + Vector Embeddings)' : '📖 Lexical Only (SQLite FTS5)'}`,
			'',
		];

		if (report.installedTarget) {
			lines.push(
				'💻 IDE Configuration:',
				`   • Configured Target: ${report.installedTarget}`,
				`   • Config Path: ${report.installedConfigPath}`,
				'',
			);
		}

		if (report.recommendations.length > 0) {
			lines.push('💡 Next Steps & Recommendations:');
			for (const rec of report.recommendations) {
				lines.push(`   👉 ${rec}`);
			}
			lines.push('');
		}

		options.print(lines.join('\n'));

		if (strict && report.mode !== 'hybrid') {
			return 1;
		}

		return 0;
	} catch (err) {
		eprint(
			`✖ Setup error: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return 1;
	}
}
