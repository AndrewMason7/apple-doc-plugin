import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEmbeddingProvider } from '../src/server/services/search/provider-factory.js';
import { runDoctorCli } from '../src/server/services/doctor-cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envFile = join(__dirname, '../.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
	try {
		process.loadEnvFile(envFile);
	} catch {}
}

let dbPath =
	process.env.APPLE_DOCS_DB_PATH || join(__dirname, '../data/apple-docs.db');
if (dbPath.includes('${extensionPath}')) {
	dbPath = dbPath.replace(/\$\{extensionPath\}/g, join(__dirname, '..'));
}

const code = await runDoctorCli({
	argv: process.argv.slice(2),
	dbPath,
	provider: resolveEmbeddingProvider(),
	nodeVersion: process.version,
	print: (text) => process.stdout.write(text),
});

process.exit(code);
