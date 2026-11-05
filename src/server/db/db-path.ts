import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * One resolver for every entry point — the MCP server, the doctor and the three
 * index scripts. They used to hardcode `data/apple-docs.db` each, so a user who
 * set APPLE_DOCS_DB_PATH was told by `doctor` to run a command that repaired a
 * different file.
 *
 * Resolution order is exactly the MCP server's historical rule:
 *   1. APPLE_DOCS_DB_PATH, if set;
 *   2. otherwise `<projectRoot>/data/apple-docs.db`;
 *   3. `${extensionPath}` expands to the project root (the MCP config token);
 *   4. anything relative resolves against the project root, never the cwd.
 *
 * This module lives at `<projectRoot>/{src,dist}/server/db/db-path.{ts,js}`, so
 * the root is three levels up in both layouts — the caller cannot drift from the
 * scripts by being invoked from a different directory.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(MODULE_DIR, '../../..');

export const DEFAULT_DB_RELATIVE_PATH = 'data/apple-docs.db';

export interface DbPathOverrides {
	/** Environment to read; defaults to process.env. Injectable for tests. */
	env?: NodeJS.ProcessEnv;
	/** Override the project root; defaults to the module's own root. */
	root?: string;
}

/** SQLite in-memory forms have no path to resolve or create a directory for. */
export const isVirtualDbPath = (dbPath: string): boolean =>
	dbPath === ':memory:' || dbPath.startsWith('file::memory:');

export function resolveDbPath(overrides: DbPathOverrides = {}): string {
	const env = overrides.env ?? process.env;
	const root = overrides.root ?? PROJECT_ROOT;

	const configured = env.APPLE_DOCS_DB_PATH?.trim();
	const candidate =
		configured && configured.length > 0
			? configured
			: join(root, DEFAULT_DB_RELATIVE_PATH);

	if (isVirtualDbPath(candidate)) return candidate;

	return resolve(root, candidate.replace(/\$\{extensionPath\}/g, root));
}
