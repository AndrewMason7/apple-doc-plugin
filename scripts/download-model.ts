#!/usr/bin/env tsx

import { downloadModel } from '../src/server/services/download-model.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
	console.log(`Usage: tsx scripts/download-model.ts [options]

Download local EmbeddingGemma GGUF model for offline hybrid semantic search.

Options:
  --force           Overwrite existing model file if present
  --dest <path>     Target local model destination path
  --url <url>       Custom GGUF download URL
  -h, --help        Show this help message
`);
	process.exit(0);
}

const force = args.includes('--force');
const urlArg =
	args.indexOf('--url') !== -1 ? args[args.indexOf('--url') + 1] : undefined;
const destArg =
	args.indexOf('--dest') !== -1 ? args[args.indexOf('--dest') + 1] : undefined;

let lastPercent = -1;

console.error('📥 Downloading local EmbeddingGemma GGUF model...');
downloadModel({
	force,
	url: urlArg,
	destination: destArg,
	onProgress: ({ loaded, total, percent }) => {
		const intPercent = Math.floor(percent);
		if (intPercent !== lastPercent && intPercent % 5 === 0) {
			lastPercent = intPercent;
			const mbLoaded = (loaded / 1024 / 1024).toFixed(1);
			const mbTotal = total > 0 ? (total / 1024 / 1024).toFixed(1) : '?';
			console.error(`   • ${intPercent}% (${mbLoaded} MB / ${mbTotal} MB)`);
		}
	},
})
	.then((result) => {
		if (result.skipped) {
			console.error(`✨ Model already present at ${result.destination}`);
		} else {
			console.error(
				`✅ Download complete: ${result.destination} (${(result.bytesDownloaded / 1024 / 1024).toFixed(1)} MB)`,
			);
		}
		process.exit(0);
	})
	.catch((err) => {
		console.error(`✖ Error: ${err.message}`);
		process.exit(1);
	});
