import { downloadVectors } from '../../server/services/download-vectors.js';

export interface DownloadVectorsCliOptions {
	argv: string[];
	print: (text: string) => void;
	eprint?: (text: string) => void;
}

const USAGE = `Usage: apple-doc-plugin download-vectors [options]

Download pre-computed 768-dimensional vector embeddings for Apple documentation.

Options:
  --force           Re-download and overwrite existing vectors
  --db <path>       Target SQLite database path
  --url <url>       Primary vector download URL
  --mirrors <urls>  Comma-separated list of fallback mirror URLs
  --sha256 <hex>    Expected SHA-256 checksum for verification
  -h, --help        Show this help message
`;

export async function runDownloadVectorsCli(
	options: DownloadVectorsCliOptions,
): Promise<number> {
	const eprint = options.eprint ?? ((t: string) => process.stderr.write(t));
	const argv = options.argv;

	if (argv.includes('--help') || argv.includes('-h')) {
		options.print(USAGE);
		return 0;
	}

	const force = argv.includes('--force');
	const urlArg =
		argv.indexOf('--url') !== -1 ? argv[argv.indexOf('--url') + 1] : undefined;
	const dbArg =
		argv.indexOf('--db') !== -1 ? argv[argv.indexOf('--db') + 1] : undefined;
	const sha256Arg =
		argv.indexOf('--sha256') !== -1
			? argv[argv.indexOf('--sha256') + 1]
			: undefined;
	const mirrorsArg =
		argv.indexOf('--mirrors') !== -1
			? argv[argv.indexOf('--mirrors') + 1].split(',').map((m) => m.trim())
			: undefined;

	let lastPercent = -1;
	eprint('📥 Downloading pre-computed vector assets...\n');
	try {
		const result = await downloadVectors({
			force,
			url: urlArg,
			dbPath: dbArg,
			mirrors: mirrorsArg,
			expectedSha256: sha256Arg,
			onProgress: ({ loaded, total, percent }) => {
				const intPercent = Math.floor(percent);
				if (intPercent !== lastPercent && intPercent % 10 === 0) {
					lastPercent = intPercent;
					const mbLoaded = (loaded / 1024 / 1024).toFixed(1);
					const mbTotal = total > 0 ? (total / 1024 / 1024).toFixed(1) : '?';
					eprint(`   • ${intPercent}% (${mbLoaded} MB / ${mbTotal} MB)\n`);
				}
			},
		});
		eprint(`✅ Vectors imported into: ${result.dbPath}\n`);
		eprint(
			`📊 Imported: ${result.importedCount} items. Total: ${result.totalVectors} (mode: ${result.mode})\n`,
		);
		if (result.sha256) {
			eprint(`🔒 SHA-256: ${result.sha256}\n`);
		}
		return 0;
	} catch (err: unknown) {
		eprint(`✖ Error: ${err instanceof Error ? err.message : String(err)}\n`);
		return 1;
	}
}
