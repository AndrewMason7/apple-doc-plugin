import { existsSync, statSync } from 'node:fs';
import type { AppleDocsDB, FreshnessInfo } from '../db/database.js';
import { MIN_SEMANTIC_ITEMS_FOR_HYBRID } from '../db/database.js';
import { isVirtualDbPath } from '../db/db-path.js';
import type { EmbeddingProvider } from './search/embedding-provider.js';
import { logger, NAME_TO_LOG_LEVEL } from '../logger.js';

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
	id: string;
	title: string;
	status: DoctorStatus;
	detail: string;
	/** Empty when status is 'ok'. Must be a copy-pasteable command. */
	nextStep: string;
}

export interface DoctorContext {
	db?: AppleDocsDB;
	dbPath: string;
	provider: EmbeddingProvider;
	nodeVersion: string;
	/** Snapshot age in days beyond which freshness warns. */
	staleAfterDays?: number;
}

export interface DoctorReport {
	ok: boolean;
	checks: DoctorCheck[];
	failures: number;
	warnings: number;
}

const STALE_AFTER_DAYS = 30;

/** Provenance as user-facing prose: internal enums must never reach the CLI. */
export const FRESHNESS_SOURCE_LABELS: Record<FreshnessInfo['source'], string> =
	{
		meta: 'from build metadata',
		'db-file-mtime': 'from the index file timestamp',
		unknown: 'unknown',
	};

/**
 * Every check the report must carry, whatever the state of the install.
 */
const SKIPPED_IDS: Array<[string, string]> = [
	['database_readable', 'Symbols'],
	['fts_index', 'FTS index'],
	['kind_integrity', 'Symbol kinds'],
	['attribution_integrity', 'Framework attribution'],
	['provider_available', 'Embedding provider'],
	['semantic_layer', 'Semantic layer'],
	['dimension_consistency', 'Vector dimensions'],
	['snapshot_freshness', 'Snapshot age'],
	['logging_config', 'Logging configuration'],
];

const check = (
	id: string,
	title: string,
	status: DoctorStatus,
	detail: string,
	nextStep = '',
): DoctorCheck => ({ id, title, status, detail, nextStep });

/**
 * Run one probe, converting any thrown error into a failing row. Doctor is a
 * diagnostic surface: a broken instalment must be reported, never raised.
 */
const safe = (
	id: string,
	title: string,
	nextStep: string,
	probe: () => DoctorCheck,
): DoctorCheck => {
	try {
		return probe();
	} catch (err) {
		return check(
			id,
			title,
			'fail',
			`check crashed: ${err instanceof Error ? err.message : String(err)}`,
			nextStep,
		);
	}
};

/**
 * Copy-pasteable install hint that is not macOS-only: the plugin ships to Linux
 * as well, where `brew` may not exist at all.
 */
const NODE_INSTALL_HINT =
	'Install Node.js 22+ — macOS: brew install node; Linux: nvm install 22 (or your distro package); Windows: winget install OpenJS.NodeJS.LTS';

/** Two steps, both literal: `export KEY=***` used to set the key to `***`. */
const PROVIDER_NEXT_STEP =
	'Set GEMINI_API_KEY (or APPLE_DOCS_EMBEDDING_MODEL_PATH) in .env, then run: npm run embed-index';

/** Render a byte count without collapsing sub-megabyte files to '0 MB'. */
const formatBytes = (bytes: number): string => {
	const megabyte = 1_048_576;
	if (bytes < megabyte) {
		return `${Math.max(0, Math.round(bytes / 1024))} KB`;
	}
	return `${(bytes / megabyte).toFixed(1)} MB`;
};

export function runDoctor(context: DoctorContext): DoctorReport {
	const checks: DoctorCheck[] = [];

	// 1. Node
	checks.push(
		safe('node_version', 'Node.js', NODE_INSTALL_HINT, () => {
			const major = Number(
				String(context.nodeVersion).replace(/^v/, '').split('.')[0],
			);
			return major >= 22
				? check('node_version', 'Node.js', 'ok', context.nodeVersion)
				: check(
						'node_version',
						'Node.js',
						'fail',
						`${context.nodeVersion} is too old`,
						NODE_INSTALL_HINT,
					);
		}),
	);

	// 2. Database file — a virtual (in-memory) path is present by definition.
	const exists = safe(
		'database_file',
		'Index file',
		'npm run build:index',
		() =>
			isVirtualDbPath(context.dbPath)
				? check('database_file', 'Index file', 'ok', 'in-memory database')
				: existsSync(context.dbPath)
					? check(
							'database_file',
							'Index file',
							'ok',
							`${context.dbPath} (${formatBytes(statSync(context.dbPath).size)})`,
						)
					: check(
							'database_file',
							'Index file',
							'fail',
							`not found at ${context.dbPath}`,
							'npm run build:index',
						),
	);
	checks.push(exists);

	const db = context.db;

	// A present-but-unreadable index is indistinguishable from an empty one by
	// row count alone — better-sqlite3 defers the failure and every getter
	// swallows it into 0/[]. Read once, before any dependent probe, then either
	// report honestly or stop.
	const readability = db?.probeReadability();

	if (!db || exists.status !== 'ok' || readability?.readable === false) {
		// Without a readable index every remaining probe is meaningless, but the
		// report still owes consumers all ten rows. A present index that cannot
		// be read is a failure; only a genuinely absent file may be skipped.
		const failureDetail =
			readability?.readable === false
				? `index is unreadable or corrupt (${readability.error})`
				: exists.status === 'ok'
					? `${context.dbPath} could not be opened — the index is unreadable or corrupt`
					: null;

		for (const [id, title] of SKIPPED_IDS) {
			checks.push(
				failureDetail
					? check(id, title, 'fail', failureDetail, 'npm run build:index')
					: check(
							id,
							title,
							'warn',
							'skipped — no readable index',
							'npm run build:index',
						),
			);
		}
		return summarise(checks);
	}

	// 3. Readable + populated
	let symbolCount = 0;
	checks.push(
		safe('database_readable', 'Symbols', 'npm run build:index', () => {
			symbolCount = db.getSymbolCount();
			return symbolCount > 0
				? check('database_readable', 'Symbols', 'ok', `${symbolCount} rows`)
				: check(
						'database_readable',
						'Symbols',
						'fail',
						'database opened but is empty',
						'npm run build:index',
					);
		}),
	);

	// 4. FTS mirror in sync
	checks.push(
		safe('fts_index', 'FTS index', 'npm run build:index', () => {
			const ftsCount = db.getFtsCount();
			return ftsCount === symbolCount
				? check('fts_index', 'FTS index', 'ok', `${ftsCount} rows`)
				: check(
						'fts_index',
						'FTS index',
						'fail',
						`${ftsCount} FTS rows vs ${symbolCount} symbols`,
						'npm run build:index',
					);
		}),
	);

	// 5. Kind classification
	checks.push(
		safe(
			'kind_integrity',
			'Symbol kinds',
			'npm run repair-index -- --apply',
			() => {
				const unknownKinds = db.countUnknownKind();
				return unknownKinds === 0
					? check(
							'kind_integrity',
							'Symbol kinds',
							'ok',
							'every row classified',
						)
					: check(
							'kind_integrity',
							'Symbol kinds',
							'warn',
							`${unknownKinds} rows have no classified kind, so symbolType filters exclude them`,
							'npm run repair-index -- --apply',
						);
			},
		),
	);

	// 6. Framework attribution
	checks.push(
		safe(
			'attribution_integrity',
			'Framework attribution',
			'npm run repair-index -- --apply',
			() => {
				const mismatches = db.countFrameworkPathMismatches();
				return mismatches === 0
					? check(
							'attribution_integrity',
							'Framework attribution',
							'ok',
							'consistent with paths',
						)
					: check(
							'attribution_integrity',
							'Framework attribution',
							'warn',
							`${mismatches} rows contradict their own path`,
							'npm run repair-index -- --apply',
						);
			},
		),
	);

	// 7. Embedding provider — foreign code, so the probe must be contained.
	checks.push(
		safe('provider_available', 'Embedding provider', PROVIDER_NEXT_STEP, () =>
			context.provider.isAvailable()
				? check(
						'provider_available',
						'Embedding provider',
						'ok',
						`${context.provider.id} (${context.provider.dimensions}-d)`,
					)
				: check(
						'provider_available',
						'Embedding provider',
						'warn',
						'none configured — hybrid search stays off, lexical still works',
						PROVIDER_NEXT_STEP,
					),
		),
	);

	// 8. Semantic layer size vs the shared hybrid gate
	checks.push(
		safe(
			'semantic_layer',
			'Semantic layer',
			'npm run download-vectors (or npm run embed-index)',
			() => {
				const embedding = db.getEmbeddingStatus();
				const threshold = MIN_SEMANTIC_ITEMS_FOR_HYBRID;
				return embedding.semanticItemCount >= threshold
					? check(
							'semantic_layer',
							'Semantic layer',
							'ok',
							`${embedding.semanticItemCount} vectors (threshold ${threshold})`,
						)
					: check(
							'semantic_layer',
							'Semantic layer',
							'warn',
							`${embedding.semanticItemCount}/${threshold} vectors — hybrid search cannot engage; queries stay lexical`,
							'npm run download-vectors (or npm run embed-index)',
						);
			},
		),
	);

	// 9. Vector width consistency
	checks.push(
		safe(
			'dimension_consistency',
			'Vector dimensions',
			'npm run embed-index -- --force',
			() => {
				const widths = db.getVectorDimensions();
				const expected = context.provider.dimensions;
				const consistent =
					widths.length === 0 ||
					(widths.length === 1 && (expected === 0 || widths[0] === expected));
				return consistent
					? check(
							'dimension_consistency',
							'Vector dimensions',
							'ok',
							widths.length === 0 ? 'no vectors stored' : `${widths[0]}-d`,
						)
					: check(
							'dimension_consistency',
							'Vector dimensions',
							'fail',
							`stored ${widths.join('/')}-d vs provider ${expected}-d — cosine scoring is invalid`,
							'npm run embed-index -- --force',
						);
			},
		),
	);

	// 10. Freshness
	checks.push(
		safe('snapshot_freshness', 'Snapshot age', 'npm run build:index', () => {
			const freshness = db.getFreshness();
			const ageDays = freshness.builtAt
				? Math.max(
						0,
						Math.floor(
							(Date.now() - Date.parse(freshness.builtAt)) / 86_400_000,
						),
					)
				: Number.NaN;
			const staleAfter = context.staleAfterDays ?? STALE_AFTER_DAYS;
			const ageLabel = `${ageDays} ${ageDays === 1 ? 'day' : 'days'} old`;
			const source = FRESHNESS_SOURCE_LABELS[freshness.source];
			return !Number.isFinite(ageDays)
				? check(
						'snapshot_freshness',
						'Snapshot age',
						'warn',
						'unknown build time',
						'npm run build:index',
					)
				: ageDays > staleAfter
					? check(
							'snapshot_freshness',
							'Snapshot age',
							'warn',
							`${ageLabel} (${source}) — new Apple APIs may be missing`,
							'npm run build:index',
						)
					: check(
							'snapshot_freshness',
							'Snapshot age',
							'ok',
							`${ageLabel} (${source})`,
						);
		}),
	);

	// 11. Logging configuration & diagnostic buffer
	checks.push(
		safe('logging_config', 'Logging configuration', '', () => {
			if (process.env.LOG_LEVEL) {
				const normalizedLevel = process.env.LOG_LEVEL.trim().toLowerCase();
				if (NAME_TO_LOG_LEVEL[normalizedLevel] === undefined) {
					return check(
						'logging_config',
						'Logging configuration',
						'warn',
						`invalid LOG_LEVEL="${process.env.LOG_LEVEL}" (expected trace, debug, info, warn, error, silent)`,
						'export LOG_LEVEL=info',
					);
				}
			}

			if (process.env.LOG_FORMAT) {
				const normalizedFormat = process.env.LOG_FORMAT.trim().toLowerCase();
				if (normalizedFormat !== 'text' && normalizedFormat !== 'json') {
					return check(
						'logging_config',
						'Logging configuration',
						'warn',
						`invalid LOG_FORMAT="${process.env.LOG_FORMAT}" (expected text, json)`,
						'export LOG_FORMAT=text',
					);
				}
			}

			const levelName = logger.getLevelName();
			const formatMode =
				process.env.LOG_FORMAT?.trim().toLowerCase() === 'json'
					? 'json'
					: 'text';
			const ring = logger.getRingBuffer();
			const errors = ring
				.getRecent()
				.filter((e) => e.level.toLowerCase() === 'error').length;
			if (errors > 0) {
				return check(
					'logging_config',
					'Logging configuration',
					'warn',
					`level: ${levelName}, ${errors} recent error(s) in diagnostic buffer`,
					'DEBUG=1 npm run doctor',
				);
			}
			return check(
				'logging_config',
				'Logging configuration',
				'ok',
				`level: ${levelName}, format: ${formatMode}, ring buffer: ${ring.size()}/${ring.getCapacity()}`,
			);
		}),
	);

	return summarise(checks);
}

function summarise(checks: DoctorCheck[]): DoctorReport {
	const failures = checks.filter((c) => c.status === 'fail').length;
	const warnings = checks.filter((c) => c.status === 'warn').length;
	return { ok: failures === 0, checks, failures, warnings };
}

const ICONS: Record<DoctorStatus, string> = { ok: '✔', warn: '⚠', fail: '✖' };

/**
 * `1 failure` / `2 failures` — the single formatter for every surface. The CLI
 * and the tools used to pluralise the same number two different ways.
 */
export function formatCount(
	count: number,
	singular: string,
	plural = `${singular}s`,
): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function formatDoctorReport(report: DoctorReport): string {
	const lines = report.checks.map((c) => {
		const head = `${ICONS[c.status]} ${c.title.padEnd(22)} ${c.detail}`;
		const nextStep = c.nextStep.trim();
		return nextStep ? `${head}\n   → ${nextStep}` : head;
	});

	// Derive the branch from the failure count, not the `ok` flag: a hand-built
	// or stale report must never claim "All checks passed" while listing failures.
	const summary =
		report.failures === 0
			? `\nAll checks passed${report.warnings > 0 ? ` (${formatCount(report.warnings, 'warning')})` : ''}.`
			: `\n${formatCount(report.failures, 'failure')}, ${formatCount(report.warnings, 'warning')}.`;

	return [...lines, summary].join('\n');
}
