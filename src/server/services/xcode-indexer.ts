import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { AppleDocsDB } from '../db/database.js';
import { safeEnsureRuntimeDbSeeded } from '../db/db-path.js';
import { indexFrameworkData, indexFrameworkTree } from './indexer.js';
import { logger } from '../logger.js';

export interface DiscoveredArchive {
	name: string;
	framework: string;
	path: string;
	hasIndexTree: boolean;
	documentationFilesCount: number;
}

export interface XcodeIndexOptions {
	dbPath?: string;
	paths?: string[];
	framework?: string;
	dryRun?: boolean;
	onProgress?: (progress: {
		archive: string;
		current: number;
		total: number;
		symbolsIndexed: number;
	}) => void;
}

export interface XcodeIndexResult {
	dbPath: string;
	archivesFound: DiscoveredArchive[];
	archivesIndexed: number;
	symbolsIndexed: number;
	dryRun: boolean;
	durationMs: number;
}

export const STANDARD_XCODE_SEARCH_PATHS = [
	'/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/share/doc',
	'/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk/usr/share/doc',
	'/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/share/doc',
	'/Applications/Xcode.app/Contents/Developer/Documentation/DocSets',
];

/**
 * Dynamically resolves search paths across developer installations (including Xcode-beta, custom DEVELOPER_DIR, and CommandLineTools).
 */
export function resolveXcodeSearchPaths(): string[] {
	const devRoots: string[] = [];

	if (process.env.DEVELOPER_DIR && existsSync(process.env.DEVELOPER_DIR)) {
		devRoots.push(process.env.DEVELOPER_DIR);
	}

	try {
		const active = execFileSync('xcode-select', ['-p'], {
			encoding: 'utf-8',
			timeout: 2000,
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		if (active && existsSync(active) && !devRoots.includes(active)) {
			devRoots.push(active);
		}
	} catch {}

	const appCandidates = [
		'/Applications/Xcode.app/Contents/Developer',
		'/Applications/Xcode-beta.app/Contents/Developer',
		'/Library/Developer/CommandLineTools',
	];
	for (const cand of appCandidates) {
		if (existsSync(cand) && !devRoots.includes(cand)) {
			devRoots.push(cand);
		}
	}

	const docPaths: string[] = [];
	for (const devRoot of devRoots) {
		docPaths.push(
			join(
				devRoot,
				'Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/share/doc',
			),
			join(
				devRoot,
				'Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk/usr/share/doc',
			),
			join(devRoot, 'Toolchains/XcodeDefault.xctoolchain/usr/share/doc'),
			join(devRoot, 'Documentation/DocSets'),
		);
	}

	// Add static standards and shared/derived paths
	docPaths.push(
		...STANDARD_XCODE_SEARCH_PATHS,
		'/Library/Developer/Shared/Documentation/DocSets',
		join(homedir(), 'Library/Developer/Shared/Documentation/DocSets'),
		join(homedir(), 'Library/Developer/Xcode/DerivedData'),
	);

	return Array.from(new Set(docPaths.filter((p) => existsSync(p))));
}

/**
 * Recursively find .doccarchive directories up to maxDepth.
 */
export function findDoccArchives(
	rootPath: string,
	maxDepth = 4,
	currentDepth = 0,
): string[] {
	if (!existsSync(rootPath) || currentDepth > maxDepth) return [];

	const archives: string[] = [];
	try {
		const stat = statSync(rootPath);
		if (!stat.isDirectory()) return [];

		if (rootPath.endsWith('.doccarchive')) {
			return [rootPath];
		}

		const entries = readdirSync(rootPath, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(rootPath, entry.name);
			if (entry.isDirectory()) {
				if (entry.name.endsWith('.doccarchive')) {
					archives.push(fullPath);
				} else if (
					!entry.name.startsWith('.') &&
					entry.name !== 'node_modules' &&
					currentDepth < maxDepth
				) {
					archives.push(
						...findDoccArchives(fullPath, maxDepth, currentDepth + 1),
					);
				}
			}
		}
	} catch (err) {
		logger.debug(`Error scanning directory ${rootPath}:`, err);
	}

	return archives;
}

/**
 * Inspect a .doccarchive directory to detect its framework name and files.
 */
export function inspectDoccArchive(archivePath: string): DiscoveredArchive {
	const folderName = basename(archivePath);
	let framework = folderName.replace(/\.doccarchive$/i, '');

	const metadataPath = join(archivePath, 'metadata.json');
	if (existsSync(metadataPath)) {
		try {
			const meta = JSON.parse(readFileSync(metadataPath, 'utf-8'));
			if (meta.bundleDisplayName) {
				framework = meta.bundleDisplayName;
			} else if (meta.bundleIdentifier) {
				const parts = meta.bundleIdentifier.split('.');
				framework = parts[parts.length - 1];
			}
		} catch {}
	}

	let hasIndexTree = false;
	const indexCandidates = [
		join(archivePath, 'data', 'index', 'index.json'),
		join(archivePath, 'index', 'index.json'),
	];
	for (const candidate of indexCandidates) {
		if (existsSync(candidate)) {
			hasIndexTree = true;
			break;
		}
	}

	let docCount = 0;
	const docDirCandidates = [
		join(archivePath, 'data', 'documentation'),
		join(archivePath, 'documentation'),
	];

	for (const docDir of docDirCandidates) {
		if (existsSync(docDir)) {
			try {
				const walk = (dir: string) => {
					const entries = readdirSync(dir, { withFileTypes: true });
					for (const entry of entries) {
						const sub = join(dir, entry.name);
						if (entry.isDirectory()) {
							walk(sub);
						} else if (entry.isFile() && entry.name.endsWith('.json')) {
							docCount++;
						}
					}
				};
				walk(docDir);
			} catch {}
			break;
		}
	}

	return {
		name: folderName,
		framework,
		path: archivePath,
		hasIndexTree,
		documentationFilesCount: docCount,
	};
}

/**
 * Ingest symbols from local Xcode doccarchives directly into SQLite.
 */
export async function indexXcodeDocs(
	options: XcodeIndexOptions = {},
): Promise<XcodeIndexResult> {
	const startTime = Date.now();
	const dbPath = options.dbPath || safeEnsureRuntimeDbSeeded();
	const dryRun = Boolean(options.dryRun);

	// Collect search paths
	const searchPaths: string[] = [];
	if (options.paths && options.paths.length > 0) {
		searchPaths.push(...options.paths);
	} else {
		searchPaths.push(...resolveXcodeSearchPaths());
	}

	// Discover all docc archives
	const discoveredPaths = new Set<string>();
	for (const sp of searchPaths) {
		const found = findDoccArchives(resolve(sp));
		for (const p of found) {
			discoveredPaths.add(p);
		}
	}

	const archives: DiscoveredArchive[] = [];
	for (const p of discoveredPaths) {
		const inspected = inspectDoccArchive(p);
		if (
			options.framework &&
			inspected.framework.toLowerCase() !== options.framework.toLowerCase()
		) {
			continue;
		}
		archives.push(inspected);
	}

	if (dryRun || archives.length === 0) {
		return {
			dbPath,
			archivesFound: archives,
			archivesIndexed: 0,
			symbolsIndexed: 0,
			dryRun,
			durationMs: Date.now() - startTime,
		};
	}

	const db = new AppleDocsDB(dbPath);
	let totalSymbolsIndexed = 0;
	let archivesIndexedCount = 0;

	try {
		for (let i = 0; i < archives.length; i++) {
			const archive = archives[i];
			let symbolsInArchive = 0;

			// 1. Ingest index tree if present
			const indexCandidates = [
				join(archive.path, 'data', 'index', 'index.json'),
				join(archive.path, 'index', 'index.json'),
			];
			for (const cand of indexCandidates) {
				if (existsSync(cand)) {
					try {
						const indexData = JSON.parse(readFileSync(cand, 'utf-8'));
						const treeCount = indexFrameworkTree(
							db,
							archive.framework,
							indexData,
						);
						symbolsInArchive += treeCount;
					} catch (err) {
						logger.debug(`Error reading tree index at ${cand}:`, err);
					}
					break;
				}
			}

			// 2. Ingest documentation pages
			const docDirCandidates = [
				join(archive.path, 'data', 'documentation'),
				join(archive.path, 'documentation'),
			];

			for (const docDir of docDirCandidates) {
				if (existsSync(docDir)) {
					const walkAndIndex = (dir: string) => {
						const entries = readdirSync(dir, { withFileTypes: true });
						for (const entry of entries) {
							const full = join(dir, entry.name);
							if (entry.isDirectory()) {
								walkAndIndex(full);
							} else if (entry.isFile() && entry.name.endsWith('.json')) {
								try {
									const docData = JSON.parse(readFileSync(full, 'utf-8'));
									const count = indexFrameworkData(
										db,
										archive.framework,
										docData,
									);
									symbolsInArchive += count;
								} catch (err) {
									logger.debug(`Error parsing doc page at ${full}:`, err);
								}
							}
						}
					};
					walkAndIndex(docDir);
					break;
				}
			}

			totalSymbolsIndexed += symbolsInArchive;
			archivesIndexedCount++;

			if (options.onProgress) {
				options.onProgress({
					archive: archive.name,
					current: i + 1,
					total: archives.length,
					symbolsIndexed: totalSymbolsIndexed,
				});
			}
		}

		// Rebuild FTS index for complete searchability
		logger.info('Rebuilding FTS5 index for newly ingested symbols...');
		db.rebuildFTS();

		const indexedAt = new Date().toISOString();
		db.setMeta('xcode_indexed_at', indexedAt);
		db.setMeta('xcode_archives_indexed', String(archivesIndexedCount));
		db.setMeta('symbol_count', String(db.getSymbolCount()));

		db.checkpointAndVacuum();
	} finally {
		db.close();
	}

	return {
		dbPath,
		archivesFound: archives,
		archivesIndexed: archivesIndexedCount,
		symbolsIndexed: totalSymbolsIndexed,
		dryRun,
		durationMs: Date.now() - startTime,
	};
}
