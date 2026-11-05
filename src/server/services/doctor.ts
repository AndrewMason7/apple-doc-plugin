import { existsSync, statSync } from 'node:fs';
import type { AppleDocsDB } from '../db/database.js';
import { MIN_SEMANTIC_ITEMS_FOR_HYBRID } from '../db/database.js';
import type { EmbeddingProvider } from './search/embedding-provider.js';

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

/** Every check the report must carry, whatever the state of the install. */
const SKIPPED_IDS: Array<[string, string]> = [
	['database_readable', 'Symbols'],
	['fts_index', 'FTS index'],
	['kind_integrity', 'Symbol kinds'],
	['attribution_integrity', 'Framework attribution'],
	['provider_available', 'Embedding provider'],
	['semantic_layer', 'Semantic layer'],
	['dimension_consistency', 'Vector dimensions'],
	['snapshot_freshness', 'Snapshot age'],
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
		safe('node_version', 'Node.js', 'brew install node', () => {
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
						'brew install node',
					);
		}),
	);

	// 2. Database file
	const exists = safe(
		'database_file',
		'Index file',
		'npm run build:index',
		() =>
			existsSync(context.dbPath)
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

	if (!context.db || exists.status !== 'ok') {
		// Without a readable index every remaining probe is meaningless, but the
		// report still owes consumers all ten rows.
		for (const [id, title] of SKIPPED_IDS) {
			checks.push(
				check(
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

	const db = context.db;

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
		safe(
			'provider_available',
			'Embedding provider',
			'export GEMINI_API_KEY=... && npm run embed-index',
			() =>
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
							'export GEMINI_API_KEY=... && npm run embed-index',
						),
		),
	);

	// 8. Semantic layer size vs the shared hybrid gate
	checks.push(
		safe('semantic_layer', 'Semantic layer', 'npm run embed-index', () => {
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
						'npm run embed-index',
					);
		}),
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
							`${ageDays} days old (${freshness.source}) — new Apple APIs may be missing`,
							'npm run build:index',
						)
					: check(
							'snapshot_freshness',
							'Snapshot age',
							'ok',
							`${ageDays} days old (${freshness.source})`,
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

export function formatDoctorReport(report: DoctorReport): string {
	const lines = report.checks.map((c) => {
		const head = `${ICONS[c.status]} ${c.title.padEnd(22)} ${c.detail}`;
		return c.nextStep ? `${head}\n   → ${c.nextStep}` : head;
	});

	const summary = report.ok
		? `\nAll checks passed${report.warnings > 0 ? ` (${report.warnings} warning${report.warnings === 1 ? '' : 's'})` : ''}.`
		: `\n${report.failures} failure${report.failures === 1 ? '' : 's'}, ${report.warnings} warning${report.warnings === 1 ? '' : 's'}.`;

	return [...lines, summary].join('\n');
}
