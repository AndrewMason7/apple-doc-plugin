import { indexXcodeDocs } from './xcode-indexer.js';

export interface XcodeCliOptions {
	argv: string[];
	print: (text: string) => void;
	eprint: (text: string) => void;
}

const USAGE = `Usage: apple-doc-plugin index-xcode [options]

Index local Apple Developer documentation and .doccarchive bundles directly and offline.

Options:
  --path <path>       Directory to search or specific .doccarchive bundle
  --framework <name>  Filter ingestion to a specific framework
  --db <path>         Target database path (default: active apple-docs.db)
  --dry-run           Scan and discover archives without modifying the database
  --json              Emit machine-readable JSON output
  -h, --help          Show this help message
`;

export async function runXcodeIndexerCli(
	options: XcodeCliOptions,
): Promise<number> {
	const { argv, print, eprint } = options;

	if (argv.includes('--help') || argv.includes('-h')) {
		print(USAGE);
		return 0;
	}

	const isJson = argv.includes('--json');
	const dryRun = argv.includes('--dry-run');

	const customPaths: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--path' && i + 1 < argv.length) {
			customPaths.push(argv[i + 1]);
		}
	}

	const fwIdx = argv.indexOf('--framework');
	const framework =
		fwIdx !== -1 && fwIdx + 1 < argv.length ? argv[fwIdx + 1] : undefined;

	const dbIdx = argv.indexOf('--db');
	const dbPath =
		dbIdx !== -1 && dbIdx + 1 < argv.length ? argv[dbIdx + 1] : undefined;

	if (!isJson) {
		eprint('🔍 Scanning for local Xcode .doccarchive bundles...\n');
	}

	try {
		const result = await indexXcodeDocs({
			dbPath,
			paths: customPaths.length > 0 ? customPaths : undefined,
			framework,
			dryRun,
			onProgress: ({ archive, current, total, symbolsIndexed }) => {
				if (!isJson) {
					eprint(
						`   • [${current}/${total}] ${archive} (+${symbolsIndexed} total symbols)\n`,
					);
				}
			},
		});

		if (isJson) {
			print(JSON.stringify({ ok: true, data: result }, null, 2) + '\n');
			return 0;
		}

		if (result.archivesFound.length === 0) {
			eprint('ℹ️ No .doccarchive bundles found in searched paths.\n');
			eprint(
				'💡 Tip: Pass a specific doccarchive using --path <path/to/Target.doccarchive>\n',
			);
			return 0;
		}

		eprint(`\n✅ Discovered ${result.archivesFound.length} archive(s):\n`);
		for (const a of result.archivesFound) {
			eprint(
				`   📦 ${a.framework} (${a.name}) - ${a.documentationFilesCount} doc pages [${a.path}]\n`,
			);
		}

		if (dryRun) {
			eprint('\n✨ Dry run complete. No symbols were written to database.\n');
		} else {
			eprint(
				`\n🎉 Ingestion complete! Indexed ${result.symbolsIndexed} symbols from ${result.archivesIndexed} archive(s) in ${(result.durationMs / 1000).toFixed(2)}s\n`,
			);
			eprint(`💾 Target DB: ${result.dbPath}\n`);
		}

		return 0;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (isJson) {
			print(JSON.stringify({ ok: false, error: msg }, null, 2) + '\n');
		} else {
			eprint(`✖ Error: ${msg}\n`);
		}
		return 1;
	}
}
