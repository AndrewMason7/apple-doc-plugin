#!/usr/bin/env node

import { exportVectors } from '../src/server/services/export-vectors.js';

async function main() {
	const args = process.argv.slice(2);

	if (args.includes('--help') || args.includes('-h')) {
		process.stdout.write(`Usage: apple-doc-plugin export-vectors [options]

Export semantic vectors into a verifiable standalone SQLite bundle with manifest.

Options:
  --output <path>     Target output database path (default: ./apple-docs-vectors-768d.db)
  --db <path>         Source database path (default: active apple-docs.db)
  --dimensions <dim>  Vector dimensionality filter (default: 768)
  --framework <name>  Filter to a specific framework
  --no-manifest       Do not generate companion .manifest.json and .sha256
  --force             Overwrite output file if it already exists
  -h, --help          Show this help message
`);
		process.exit(0);
	}

	const force = args.includes('--force');
	const writeManifest = !args.includes('--no-manifest');

	const outputIdx = args.indexOf('--output');
	const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

	const dbIdx = args.indexOf('--db');
	const sourceDbPath = dbIdx !== -1 ? args[dbIdx + 1] : undefined;

	const dimIdx = args.indexOf('--dimensions');
	const dimensions = dimIdx !== -1 ? parseInt(args[dimIdx + 1], 10) : 768;

	const fwIdx = args.indexOf('--framework');
	const framework = fwIdx !== -1 ? args[fwIdx + 1] : undefined;

	let lastPercent = -1;
	process.stderr.write(`📦 Exporting ${dimensions}-d vectors...\n`);

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
					process.stderr.write(
						`   • ${intPercent}% (${exported} / ${total})\n`,
					);
				}
			},
		});

		process.stderr.write(`✅ Export succeeded: ${result.outputPath}\n`);
		process.stderr.write(
			`📊 Vectors: ${result.totalVectors} | Size: ${(result.byteSize / 1024 / 1024).toFixed(2)} MB\n`,
		);
		process.stderr.write(`🔒 SHA-256: ${result.sha256}\n`);
		if (result.manifestPath) {
			process.stderr.write(`📄 Manifest: ${result.manifestPath}\n`);
		}
		process.exit(0);
	} catch (err: unknown) {
		process.stderr.write(
			`✖ Export error: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('Fatal export error:', err);
	process.exit(1);
});
