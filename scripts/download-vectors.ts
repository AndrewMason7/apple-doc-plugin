#!/usr/bin/env tsx

import { downloadVectors } from '../src/server/services/download-vectors.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
	console.log(`Usage: tsx scripts/download-vectors.ts [options]

Download pre-computed 768-dimensional vector embeddings for Apple documentation.

Options:
  --force           Re-download and overwrite existing vectors
  --db <path>       Target SQLite database path
  --url <url>       Primary vector download URL
  --mirrors <urls>  Comma-separated list of fallback mirror URLs
  --sha256 <hex>    Expected SHA-256 checksum for verification
  -h, --help        Show this help message
`);
	process.exit(0);
}

const force = args.includes('--force');
const urlArg =
	args.indexOf('--url') !== -1 ? args[args.indexOf('--url') + 1] : undefined;
const dbArg =
	args.indexOf('--db') !== -1 ? args[args.indexOf('--db') + 1] : undefined;
const sha256Arg =
	args.indexOf('--sha256') !== -1
		? args[args.indexOf('--sha256') + 1]
		: undefined;
const mirrorsArg =
	args.indexOf('--mirrors') !== -1
		? args[args.indexOf('--mirrors') + 1].split(',').map((m) => m.trim())
		: undefined;

let lastPercent = -1;

console.error(
	'📥 Downloading pre-computed vector assets with resilient mirror fallback...',
);
downloadVectors({
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
			console.error(`   • ${intPercent}% (${mbLoaded} MB / ${mbTotal} MB)`);
		}
	},
})
	.then((result) => {
		console.error(`✅ Vectors imported into: ${result.dbPath}`);
		console.error(
			`📊 Imported: ${result.importedCount} items. Total: ${result.totalVectors} (mode: ${result.mode})`,
		);
		if (result.sha256) {
			console.error(`🔒 Verified SHA-256: ${result.sha256}`);
		}
		process.exit(0);
	})
	.catch((err) => {
		console.error(`✖ Error: ${err.message}`);
		process.exit(1);
	});
