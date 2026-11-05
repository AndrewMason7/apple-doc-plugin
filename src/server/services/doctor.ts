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

const check = (
	id: string,
	title: string,
	status: DoctorStatus,
	detail: string,
	nextStep = '',
): DoctorCheck => ({ id, title, status, detail, nextStep });

export function runDoctor(context: DoctorContext): DoctorReport {
	const checks: DoctorCheck[] = [];

	// 1. Node
	const major = Number(
		String(context.nodeVersion).replace(/^v/, '').split('.')[0],
	);
	checks.push(
		major >= 22
			? check('node_version', 'Node.js', 'ok', context.nodeVersion)
			: check(
					'node_version',
					'Node.js',
					'fail',
					`${context.nodeVersion} is too old`,
					'Install Node 22+: brew install node (or fnm install 22)',
				),
	);

	// 2. Database file
	const exists = existsSync(context.dbPath);
	checks.push(
		exists
			? check(
					'database_file',
					'Index file',
					'ok',
					`${context.dbPath} (${Math.round(statSync(context.dbPath).size / 1_048_576)} MB)`,
				)
			: check(
					'database_file',
					'Index file',
					'fail',
					`not found at ${context.dbPath}`,
					'npm run build:index',
				),
	);

	if (!context.db || !exists) {
		// Without a database the remaining checks are meaningless; stop here.
		return summarise(checks);
	}

	const db = context.db;

	// 3. Readable + populated
	const symbolCount = db.getSymbolCount();
	checks.push(
		symbolCount > 0
			? check('database_readable', 'Symbols', 'ok', `${symbolCount} rows`)
			: check(
					'database_readable',
					'Symbols',
					'fail',
					'database opened but is empty',
					'npm run build:index',
				),
	);

	// 4. FTS mirror in sync
	const ftsCount = db.getFtsCount();
	checks.push(
		ftsCount === symbolCount
			? check('fts_index', 'FTS index', 'ok', `${ftsCount} rows`)
			: check(
					'fts_index',
					'FTS index',
					'fail',
					`${ftsCount} FTS rows vs ${symbolCount} symbols`,
					'npm run build:index',
				),
	);

	// 5. Kind classification
	const unknownKinds = db.countUnknownKind();
	checks.push(
		unknownKinds === 0
			? check('kind_integrity', 'Symbol kinds', 'ok', 'every row classified')
			: check(
					'kind_integrity',
					'Symbol kinds',
					'warn',
					`${unknownKinds} rows have no classified kind, so symbolType filters exclude them`,
					'npm run repair-index -- --apply',
				),
	);

	// 6. Framework attribution
	const mismatches = db.countFrameworkPathMismatches();
	checks.push(
		mismatches === 0
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
				),
	);

	// 7. Embedding provider
	const providerAvailable = context.provider.isAvailable();
	checks.push(
		providerAvailable
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
					'Set GEMINI_API_KEY (https://aistudio.google.com/) or APPLE_DOCS_EMBEDDING_MODEL_PATH, then npm run embed-index',
				),
	);

	// 8. Semantic layer size vs gate
	const embedding = db.getEmbeddingStatus();
	checks.push(
		embedding.hybridEnabled
			? check(
					'semantic_layer',
					'Semantic layer',
					'ok',
					`${embedding.semanticItemCount} vectors (threshold ${embedding.threshold})`,
				)
			: check(
					'semantic_layer',
					'Semantic layer',
					'warn',
					`${embedding.semanticItemCount}/${embedding.threshold} vectors — hybrid search cannot engage; queries stay lexical`,
					'npm run embed-index',
				),
	);

	// 9. Vector width consistency
	const widths = db.getVectorDimensions();
	const expected = context.provider.dimensions;
	const consistent =
		widths.length === 0 ||
		(widths.length === 1 && (expected === 0 || widths[0] === expected));
	checks.push(
		consistent
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
				),
	);

	// 10. Freshness
	const freshness = db.getFreshness();
	const ageDays = freshness.builtAt
		? Math.floor((Date.now() - Date.parse(freshness.builtAt)) / 86_400_000)
		: Number.NaN;
	const staleAfter = context.staleAfterDays ?? STALE_AFTER_DAYS;
	checks.push(
		!Number.isFinite(ageDays)
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
					),
	);

	return summarise(checks);
}

function summarise(checks: DoctorCheck[]): DoctorReport {
	const failures = checks.filter((c) => c.status === 'fail').length;
	const warnings = checks.filter((c) => c.status === 'warn').length;
	return { ok: failures === 0, checks, failures, warnings };
}
