import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { AppleDevDocsClient } from '../apple-client.js';
import { ServerState } from './state.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import { AppleDocsDB } from './db/database.js';
import { resolveDbPath } from './db/db-path.js';
import { HybridSearchEngine } from './services/search/hybrid-search.js';
import {
	findLocalVectorArtifact,
	autoImportBundledVectors,
} from './services/download-vectors.js';
import { loadEnvironment } from './env.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'app' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJsonPath = join(__dirname, '../../package.json');
let packageVersion = '1.0.0';
try {
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
		version: string;
	};
	if (packageJson?.version) {
		packageVersion = packageJson.version;
	}
} catch {}

export const createServer = () => {
	const server = new Server(
		{
			name: 'apple-dev-docs-mcp',
			version: packageVersion,
		},
		{
			capabilities: {
				tools: {},
				resources: {},
				prompts: {},
				logging: {},
			},
		},
	);

	// Ensure .env is loaded if createServer is invoked directly
	const projectEnv = join(__dirname, '../../.env');
	loadEnvironment(projectEnv);

	const client = new AppleDevDocsClient();
	const state = new ServerState();

	// Initialize database and hybrid search engine if database file exists
	let db: AppleDocsDB | undefined;
	let searchEngine: HybridSearchEngine | undefined;

	// Same resolver as `npm run doctor` and the index scripts: a custom
	// APPLE_DOCS_DB_PATH must point every surface at the same file.
	const dbPath = resolveDbPath();
	if (existsSync(dbPath)) {
		try {
			db = new AppleDocsDB(dbPath, { readonly: true });
			searchEngine = new HybridSearchEngine(db);

			// Zero-step hybrid search: if fresh database has 0 semantic items,
			// automatically import the bundled local vector artifact in the background.
			if (db.getSemanticItemCount() === 0 && findLocalVectorArtifact()) {
				autoImportBundledVectors({ dbPath, db }).catch((err) => {
					log.debug('Background bundled vector import deferred:', err);
				});
			}
		} catch (err) {
			log.error(
				'Failed to open pre-indexed SQLite database, falling back to dynamic search:',
				err,
			);
			db = undefined;
			searchEngine = undefined;
		}
	}

	const context = { client, state, db, searchEngine };
	registerTools(server, context);
	registerResources(server, context);
	registerPrompts(server);

	return server;
};
