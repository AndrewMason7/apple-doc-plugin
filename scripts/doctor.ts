import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmbeddingProvider } from '../src/server/services/search/embedding-provider.js';
import { resolveEmbeddingProvider } from '../src/server/services/search/provider-factory.js';
import { runDoctorCli } from '../src/server/services/doctor-cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envFile = join(__dirname, '../.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
	try {
		process.loadEnvFile(envFile);
	} catch (err) {
		// Non-fatal, but never silent: a malformed .env otherwise shows up only
		// as a bogus 'none configured' provider warning. STDERR only — stdout
		// must stay parseable under --json.
		console.error(
			`doctor: could not read ${envFile}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

let dbPath =
	process.env.APPLE_DOCS_DB_PATH || join(__dirname, '../data/apple-docs.db');
if (dbPath.includes('${extensionPath}')) {
	dbPath = dbPath.replace(/\$\{extensionPath\}/g, join(__dirname, '..'));
}

// A doctor that dies while constructing a provider is worse than one that
// reports the provider unavailable: the whole point is to print a report.
let provider: EmbeddingProvider;
try {
	provider = resolveEmbeddingProvider();
} catch (err) {
	console.error(
		`doctor: could not initialise the embedding provider: ${err instanceof Error ? err.message : String(err)}`,
	);
	provider = {
		id: 'unavailable' as const,
		dimensions: 0,
		isAvailable: () => false,
		embedQuery: async () => null,
		embedDocument: async () => null,
	};
}

const code = await runDoctorCli({
	argv: process.argv.slice(2),
	dbPath,
	provider,
	nodeVersion: process.version,
	print: (text) => process.stdout.write(text),
});

// exitCode lets queued stdout drain; process.exit() can truncate a piped report.
process.exitCode = code;
