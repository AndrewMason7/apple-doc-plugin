import { exportVectors } from '../../server/services/export-vectors.js';

export interface ExportVectorsCliOptions {
	argv: string[];
	print: (text: string) => void;
	eprint?: (text: string) => void;
}

const USAGE = `Usage: apple-doc-plugin export-vectors [options]

Export semantic vectors into a verifiable standalone SQLite bundle with manifest.

Options:
  --output <path>     Target output database path (default: ./apple-docs-vectors-768d.db)
  --db <path>         Source database path (default: active apple-docs.db)
  --dimensions <dim>  Vector dimensionality filter (default: 768)
  --framework <name>  Filter to a specific framework
  --no-manifest       Do not generate companion .manifest.json and .sha256
  --force             Overwrite output file if it already exists
  -h, --help          Show this help message
`;

export async function runExportVectorsCli(
	options: ExportVectorsCliOptions,
): Promise<number> {
	const eprint = options.eprint ?? ((t: string) => process.stderr.write(t));
	const argv = options.argv;

	if (argv.includes('--help') || argv.includes('-h')) {
		options.print(USAGE);
		return 0;
	}

	const force = argv.includes('--force');
	const writeManifest = !argsIncludes(argv, '--no-manifest');
	const outputIdx = argv.indexOf('--output');
	const outputPath = outputIdx !== -1 ? argv[outputIdx + 1] : undefined;
	const dbIdx = argv.indexOf('--db');
	const sourceDbPath = dbIdx !== -1 ? argv[dbIdx + 1] : undefined;
	const dimIdx = argv.indexOf('--dimensions');
	const dimensions = dimIdx !== -1 ? parseInt(argv[dimIdx + 1], 10) : 768;
	const fwIdx = argv.indexOf('--framework');
	const framework = fwIdx !== -1 ? argv[fwIdx + 1] : undefined;

	let lastPercent = -1;
	eprint(`📦 Exporting ${dimensions}-d vectors...\n`);
	try {
		const result = await exportVectors({
			sourceDbPath,
			outputPath,
			dimensions,
			framework,
			writeManifest,
			force,
			onProgress: ({ exported, total, percent }) => {
				const intPercent = Math.floor(percent);
				if (intPercent !== lastPercent && intPercent % 10 === 0) {
					lastPercent = intPercent;
					eprint(`   • ${intPercent}% (${exported} / ${total})\n`);
				}
			},
		});

		eprint(`✅ Export succeeded: ${result.outputPath}\n`);
		eprint(
			`📊 Vectors: ${result.totalVectors} | Size: ${(result.byteSize / 1024 / 1024).toFixed(2)} MB\n`,
		);
		eprint(`🔒 SHA-256: ${result.sha256}\n`);
		if (result.manifestPath) {
			eprint(`📄 Manifest: ${result.manifestPath}\n`);
		}
		return 0;
	} catch (err: unknown) {
		eprint(`✖ Error: ${err instanceof Error ? err.message : String(err)}\n`);
		return 1;
	}
}

function argsIncludes(argv: string[], flag: string): boolean {
	return argv.includes(flag);
}
