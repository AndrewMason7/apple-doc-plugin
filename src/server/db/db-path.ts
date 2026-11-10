import {
	accessSync,
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	renameSync,
	unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * Shared database path resolver for the MCP server, CLI commands, and scripts.
 *
 * `data/apple-docs.db` is the immutable git-tracked lexical seed shipped in the
 * npm tarball (`< 50 MB`). Runtime vector hydration and local Xcode indexing
 * write to `data/apple-docs.runtime.db` (or `$XDG_CACHE_HOME/apple-docs/` when
 * the install directory is read-only) so git status stays clean and `npm pack`
 * never balloons past the 75 MB ceiling.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(MODULE_DIR, '../../..');

export const SEED_DB_RELATIVE_PATH = join('data', 'apple-docs.db');

export const DEFAULT_DB_RELATIVE_PATH = join('data', 'apple-docs.runtime.db');

export interface DbPathOverrides {
	/** Environment to read; defaults to process.env. Injectable for tests. */
	env?: NodeJS.ProcessEnv;
	/** Override the project root; defaults to the module's own root. */
	root?: string;
	/** Injectable writability check for `<root>/data` (defaults to fs.accessSync W_OK). */
	writableCheck?: (dir: string) => boolean;
	/** Override user home directory for XDG fallback tests. */
	homeDir?: string;
}

/** SQLite in-memory forms have no path to resolve or create a directory for. */
export const isVirtualDbPath = (dbPath: string): boolean =>
	dbPath === ':memory:' || dbPath.startsWith('file::memory:');

const defaultWritableCheck = (targetDir: string): boolean => {
	try {
		const probe = existsSync(targetDir) ? targetDir : dirname(targetDir);
		accessSync(probe, constants.W_OK);
		return true;
	} catch {
		return false;
	}
};

/**
 * Path to the immutable shipped lexical seed (`data/apple-docs.db`).
 * Written only by `scripts/build-index.ts` unless `APPLE_DOCS_DB_PATH` overrides it.
 */
export function resolveSeedDbPath(overrides: DbPathOverrides = {}): string {
	const env = overrides.env ?? process.env;
	const root = overrides.root ?? PROJECT_ROOT;

	const configured = env.APPLE_DOCS_DB_PATH?.trim();
	if (configured && configured.length > 0) {
		if (isVirtualDbPath(configured)) return configured;
		return resolve(root, configured.replace(/\$\{extensionPath\}/g, root));
	}

	return join(root, SEED_DB_RELATIVE_PATH);
}

export function resolveDbPath(overrides: DbPathOverrides = {}): string {
	const env = overrides.env ?? process.env;
	const root = overrides.root ?? PROJECT_ROOT;

	const configured = env.APPLE_DOCS_DB_PATH?.trim();
	if (configured && configured.length > 0) {
		if (isVirtualDbPath(configured)) return configured;
		return resolve(root, configured.replace(/\$\{extensionPath\}/g, root));
	}

	const isWritable = overrides.writableCheck ?? defaultWritableCheck;
	const dataDir = join(root, 'data');
	if (isWritable(dataDir)) {
		return join(root, DEFAULT_DB_RELATIVE_PATH);
	}

	const xdgCache = env.XDG_CACHE_HOME?.trim();
	const baseCache =
		xdgCache && xdgCache.length > 0
			? xdgCache
			: join(overrides.homeDir ?? homedir(), '.cache');
	return join(baseCache, 'apple-docs', 'apple-docs.runtime.db');
}

const readBuiltAt = (filePath: string): string | null => {
	if (!existsSync(filePath)) return null;
	let db: Database.Database | undefined;
	try {
		db = new Database(filePath, { readonly: true });
		const row = db
			.prepare("SELECT value FROM meta WHERE key = 'built_at'")
			.get() as { value?: string } | undefined;
		return typeof row?.value === 'string' ? row.value : null;
	} catch {
		return null;
	} finally {
		try {
			db?.close();
		} catch {}
	}
};

/**
 * Ensure the writable runtime database exists and matches the shipped seed's
 * `built_at` stamp, atomically copying `data/apple-docs.db` on first run or
 * after an index upgrade while stripping stale `-wal`/`-shm` sidecars first.
 * Never touches an explicit `APPLE_DOCS_DB_PATH` or in-memory database.
 */
export function ensureRuntimeDbSeeded(overrides: DbPathOverrides = {}): string {
	const env = overrides.env ?? process.env;
	const target = resolveDbPath(overrides);

	const configured = env.APPLE_DOCS_DB_PATH?.trim();
	if ((configured && configured.length > 0) || isVirtualDbPath(target)) {
		return target;
	}

	const root = overrides.root ?? PROJECT_ROOT;
	const seedPath = join(root, SEED_DB_RELATIVE_PATH);
	if (!existsSync(seedPath) || seedPath === target) {
		return target;
	}

	const targetExists = existsSync(target);
	const seedBuiltAt = readBuiltAt(seedPath);
	const targetBuiltAt = targetExists ? readBuiltAt(target) : null;

	const needsRefresh =
		!targetExists || (seedBuiltAt !== null && seedBuiltAt !== targetBuiltAt);

	if (!needsRefresh) {
		return target;
	}

	mkdirSync(dirname(target), { recursive: true });
	const tmpPath = `${target}.seed.${process.pid}.${Date.now()}.tmp`;
	try {
		copyFileSync(seedPath, tmpPath);
		for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
			if (existsSync(sidecar)) {
				try {
					unlinkSync(sidecar);
				} catch {}
			}
		}
		renameSync(tmpPath, target);
	} catch (err) {
		if (existsSync(tmpPath)) {
			try {
				unlinkSync(tmpPath);
			} catch {}
		}
		throw err;
	}

	return target;
}
