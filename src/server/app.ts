import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { AppleDevDocsClient } from '../apple-client.js';
import { ServerState } from './state.js';
import { registerTools } from './tools.js';
import { AppleDocsDB } from './db/database.js';
import { HybridSearchEngine } from './services/search/hybrid-search.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
	version: string;
};

export const createServer = () => {
	const server = new Server(
		{
			name: 'apple-dev-docs-mcp',
			version: packageJson.version,
		},
		{
			capabilities: {
				tools: {},
			},
		},
	);

	// Ensure .env is loaded if createServer is invoked directly
	if (typeof process.loadEnvFile === 'function') {
		const projectEnv = join(__dirname, '../../.env');
		try {
			if (existsSync(projectEnv)) {
				process.loadEnvFile(projectEnv);
			} else {
				process.loadEnvFile();
			}
		} catch {}
	}

	const client = new AppleDevDocsClient();
	const state = new ServerState();

	// Initialize database and hybrid search engine if database file exists
	let db: AppleDocsDB | undefined;
	let searchEngine: HybridSearchEngine | undefined;

	const dbPath =
		process.env.APPLE_DOCS_DB_PATH ||
		join(__dirname, '../../data/apple-docs.db');
	if (existsSync(dbPath)) {
		try {
			db = new AppleDocsDB(dbPath, { readonly: true });
			searchEngine = new HybridSearchEngine(db);
		} catch (err) {
			console.error(
				'Failed to open pre-indexed SQLite database, falling back to dynamic search:',
				err instanceof Error ? err.message : err,
			);
		}
	}

	registerTools(server, { client, state, db, searchEngine });

	return server;
};
