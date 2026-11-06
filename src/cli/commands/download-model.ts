import { downloadModel } from '../../server/services/download-model.js';

export interface DownloadModelCliOptions {
	argv: string[];
	print: (text: string) => void;
	eprint?: (text: string) => void;
}

const USAGE = `Usage: apple-doc-plugin download-model [options]

Download local EmbeddingGemma GGUF model for offline hybrid semantic search.

Options:
  --force           Overwrite existing model file if present
  --dest <path>     Target local model destination path
  --url <url>       Custom GGUF download URL
  -h, --help        Show this help message
`;

export async function runDownloadModelCli(
	options: DownloadModelCliOptions,
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
	const destArg =
		argv.indexOf('--dest') !== -1
			? argv[argv.indexOf('--dest') + 1]
			: undefined;

	let lastPercent = -1;
	eprint('📥 Downloading local EmbeddingGemma GGUF model...\n');
	try {
		const result = await downloadModel({
			force,
			url: urlArg,
			destination: destArg,
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
		if (result.skipped) {
			eprint(`✨ Model already present at ${result.destination}\n`);
		} else {
			eprint(
				`✅ Download complete: ${result.destination} (${(result.bytesDownloaded / 1024 / 1024).toFixed(1)} MB)\n`,
			);
		}
		return 0;
	} catch (err: unknown) {
		eprint(`✖ Error: ${err instanceof Error ? err.message : String(err)}\n`);
		return 1;
	}
}
