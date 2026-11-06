#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server/app.js';
import { loadEnvironment } from './server/env.js';
import { logger } from './server/logger.js';
import { resolveDbPath } from './server/db/db-path.js';
import { runDoctorCli } from './server/services/doctor-cli.js';
import {
	UnavailableEmbeddingProvider,
	resolveEmbeddingProvider,
} from './server/services/search/provider-factory.js';
import { downloadModel } from './server/services/download-model.js';
import { downloadVectors } from './server/services/download-vectors.js';

// Attach process lifecycle safety guards to keep MCP stdio stream alive
process.on('uncaughtException', (err: Error) => {
	logger.error('CRITICAL: Uncaught exception in process:', err);
});

process.on('unhandledRejection', (reason: unknown) => {
	logger.error('WARNING: Unhandled promise rejection in process:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectEnv = join(__dirname, '../.env');
loadEnvironment(projectEnv);

const USAGE = `Apple Developer Documentation MCP Server & Toolkit

Usage:
  apple-doc-plugin                       Launch the MCP server on stdio (default)
  apple-doc-plugin doctor [--json]       Check index health and embedding provider
  apple-doc-plugin download-vectors      Download pre-computed vector index for semantic search
  apple-doc-plugin download-model        Download local EmbeddingGemma GGUF model
  apple-doc-plugin --help                Show this help message
`;

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (command === '--help' || command === '-h' || command === 'help') {
		process.stdout.write(USAGE);
		process.exit(0);
	}

	if (command === 'doctor') {
		const dbPath = resolveDbPath();
		let provider;
		try {
			provider = resolveEmbeddingProvider();
		} catch (err) {
			logger.warn('Could not initialise embedding provider for doctor:', err);
			provider = new UnavailableEmbeddingProvider();
		}

		const exitCode = await runDoctorCli({
			argv: args.slice(1),
			dbPath,
			provider,
			nodeVersion: process.version,
			print: (text) => process.stdout.write(text),
			eprint: (text) => process.stderr.write(text),
		});
		process.exit(exitCode);
	}

	if (command === 'download-model') {
		if (args.includes('--help') || args.includes('-h')) {
			process.stdout.write(
				`Usage: apple-doc-plugin download-model [options]

Download local EmbeddingGemma GGUF model for offline hybrid semantic search.

Options:
  --force           Overwrite existing model file if present
  --dest <path>     Target local model destination path
  --url <url>       Custom GGUF download URL
  -h, --help        Show this help message
`,
			);
			process.exit(0);
		}

		const force = args.includes('--force');
		const urlArg =
			args.indexOf('--url') !== -1
				? args[args.indexOf('--url') + 1]
				: undefined;
		const destArg =
			args.indexOf('--dest') !== -1
				? args[args.indexOf('--dest') + 1]
				: undefined;

		let lastPercent = -1;
		process.stderr.write('📥 Downloading local EmbeddingGemma GGUF model...\n');
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
						process.stderr.write(
							`   • ${intPercent}% (${mbLoaded} MB / ${mbTotal} MB)\n`,
						);
					}
				},
			});
			if (result.skipped) {
				process.stderr.write(
					`✨ Model already present at ${result.destination}\n`,
				);
			} else {
				process.stderr.write(
					`✅ Download complete: ${result.destination} (${(result.bytesDownloaded / 1024 / 1024).toFixed(1)} MB)\n`,
				);
			}
			process.exit(0);
		} catch (err: unknown) {
			process.stderr.write(
				`✖ Error: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			process.exit(1);
		}
	}

	if (command === 'download-vectors') {
		if (args.includes('--help') || args.includes('-h')) {
			process.stdout.write(
				`Usage: apple-doc-plugin download-vectors [options]

Download pre-computed 768-dimensional vector embeddings for Apple documentation.

Options:
  --force           Re-download and overwrite existing vectors
  --db <path>       Target SQLite database path
  --url <url>       Custom vector download URL
  -h, --help        Show this help message
`,
			);
			process.exit(0);
		}

		const force = args.includes('--force');
		const urlArg =
			args.indexOf('--url') !== -1
				? args[args.indexOf('--url') + 1]
				: undefined;
		const dbArg =
			args.indexOf('--db') !== -1 ? args[args.indexOf('--db') + 1] : undefined;

		let lastPercent = -1;
		process.stderr.write('📥 Downloading pre-computed vector assets...\n');
		try {
			const result = await downloadVectors({
				force,
				url: urlArg,
				dbPath: dbArg,
				onProgress: ({ loaded, total, percent }) => {
					const intPercent = Math.floor(percent);
					if (intPercent !== lastPercent && intPercent % 10 === 0) {
						lastPercent = intPercent;
						const mbLoaded = (loaded / 1024 / 1024).toFixed(1);
						const mbTotal = total > 0 ? (total / 1024 / 1024).toFixed(1) : '?';
						process.stderr.write(
							`   • ${intPercent}% (${mbLoaded} MB / ${mbTotal} MB)\n`,
						);
					}
				},
			});
			process.stderr.write(`✅ Vectors imported into: ${result.dbPath}\n`);
			process.stderr.write(
				`📊 Imported: ${result.importedCount} items. Total: ${result.totalVectors} (mode: ${result.mode})\n`,
			);
			process.exit(0);
		} catch (err: unknown) {
			process.stderr.write(
				`✖ Error: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			process.exit(1);
		}
	}

	if (command && command !== 'server') {
		process.stderr.write(`Unknown command or option: "${command}"\n\n${USAGE}`);
		process.exit(2);
	}

	// Default: Launch MCP stdio server
	const server = createServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	logger.info('Apple Developer Documentation MCP server running on stdio');
}

main().catch((err) => {
	logger.error('Fatal launcher error:', err);
	process.exit(1);
});
