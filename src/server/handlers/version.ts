import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJsonPath = join(__dirname, '../../../package.json');
let packageJson = {
	version: '1.0.0',
	name: 'apple-doc-plugin',
	description: 'Apple Developer Documentation MCP Server',
	author: 'Andrew Mason',
	repository: { url: 'https://github.com/AndrewMason7/apple-doc-plugin' },
};
try {
	packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
} catch {}

import type { ServerContext, ToolResponse } from '../context.js';
import { CORE_FRAMEWORKS } from '../db/frameworks.js';
import type {
	EmbeddingStatus,
	FreshnessInfo,
	KindCount,
} from '../db/database.js';
import { MIN_SEMANTIC_ITEMS_FOR_HYBRID } from '../db/database.js';
import {
	formatCount,
	FRESHNESS_SOURCE_LABELS,
	runDoctor,
} from '../services/doctor.js';
import { isAutoImportInFlight } from '../services/download-vectors.js';
import { UnavailableEmbeddingProvider } from '../services/search/provider-factory.js';
import {
	areEmbeddingModelsCompatible,
	type EmbeddingProvider,
} from '../services/search/embedding-provider.js';

/**
 * `index_info` is read-only and runs on every call inside the MCP server, so it
 * must never construct a real embedding provider (that can load a 300 MB GGUF).
 * When the caller has no live search engine we hand the doctor an honest
 * "nothing configured" stub — the same object the rest of the server uses.
 */
const UNAVAILABLE_PROVIDER: EmbeddingProvider =
	new UnavailableEmbeddingProvider();

/**
 * Frameworks with fewer symbols than this are cross-reference targets (a
 * SwiftUI page linking to WidgetKit), not frameworks whose documentation is
 * indexed. Keeping them apart stops "Indexed Frameworks" from overstating
 * coverage.
 */
export const INDEXED_FRAMEWORK_MIN_SYMBOLS = 25;

export interface IndexMetadata {
	version: string;
	serverName: string;
	dbPath: string;
	symbolCount: number;
	indexedFrameworks: string[];
	crossReferenceFrameworks: string[];
	builtAt: string;
	freshness: FreshnessInfo;
	embeddingStatus: EmbeddingStatus;
	/** True when background bundled vector hydration is actively running on an empty index. */
	hydrating: boolean;
	/** Width of the stored vectors, from one row; `null` when none exist. */
	storedVectorWidth: number | null;
	/** Model identifier recorded in `meta.embedding_model`; `null` when unrecorded. */
	storedEmbeddingModel: string | null;
	unknownKindCount: number;
	frameworkMismatchCount: number;
	kindDistribution: KindCount[];
}

const FALLBACK_EMBEDDING_STATUS: EmbeddingStatus = {
	semanticItemCount: 0,
	threshold: MIN_SEMANTIC_ITEMS_FOR_HYBRID,
	hybridEnabled: false,
	mode: 'lexical-only',
	storageHasVectors: false,
};

export const getIndexMetadata = (context?: ServerContext): IndexMetadata => {
	const db = context?.db;
	db?.assertNotReplaced();
	const symbolCount = db ? db.getSymbolCount() : 0;
	const frameworkCounts = db ? db.getFrameworkSymbolCounts() : [];
	const indexedFrameworks =
		frameworkCounts.length > 0
			? frameworkCounts
					.filter((entry) => entry.count >= INDEXED_FRAMEWORK_MIN_SYMBOLS)
					.map((entry) => entry.framework)
			: [...CORE_FRAMEWORKS];
	const crossReferenceFrameworks = frameworkCounts
		.filter((entry) => entry.count < INDEXED_FRAMEWORK_MIN_SYMBOLS)
		.map((entry) => entry.framework);

	const freshness: FreshnessInfo = db
		? db.getFreshness()
		: { builtAt: 'unknown', source: 'unknown' };
	const embeddingStatus: EmbeddingStatus = db
		? db.getEmbeddingStatus()
		: FALLBACK_EMBEDDING_STATUS;
	const hydrating =
		!embeddingStatus.storageHasVectors && isAutoImportInFlight();
	// One row is enough for the status line; the multi-width check is doctor's
	// dimension_consistency, which scans DISTINCT widths (too slow for a tool
	// that runs on every call).
	const storedVectorWidth =
		db && embeddingStatus.storageHasVectors ? db.getStoredVectorWidth() : null;
	const storedEmbeddingModel =
		db && embeddingStatus.storageHasVectors
			? db.getStoredEmbeddingModel()
			: null;

	return {
		version: packageJson.version,
		serverName: packageJson.name,
		dbPath: db?.dbPath || 'None (uninitialized)',
		symbolCount,
		indexedFrameworks,
		crossReferenceFrameworks,
		builtAt: freshness.builtAt,
		freshness,
		embeddingStatus,
		hydrating,
		storedVectorWidth,
		storedEmbeddingModel,
		unknownKindCount: db ? db.countUnknownKind() : 0,
		frameworkMismatchCount: db ? db.countFrameworkPathMismatches() : 0,
		kindDistribution: db ? db.getKindDistribution() : [],
	};
};

const describeFreshness = (freshness: FreshnessInfo): string => {
	if (freshness.source === 'meta') return freshness.builtAt;
	if (freshness.source === 'db-file-mtime') {
		return `${freshness.builtAt} (db file mtime — snapshot built_at not recorded)`;
	}
	return 'unknown (snapshot not recorded and db file unavailable)';
};

export interface DimensionMismatch {
	stored: number;
	expected: number;
}

/**
 * A corpus that cannot be scored against the query vector is not "hybrid" just
 * because it holds 19,473 rows. Both status tools must say so, because the
 * search path silently falls back to lexical in exactly this state.
 */
const resolveDimensionMismatch = (
	stored: number | null,
	expected: number,
): DimensionMismatch | null =>
	stored !== null && stored > 0 && expected > 0 && stored !== expected
		? { stored, expected }
		: null;

export interface ModelMismatch {
	stored: string;
	expected: string;
}

const resolveModelMismatch = (
	stored: string | null,
	expected: string | null | undefined,
): ModelMismatch | null =>
	!areEmbeddingModelsCompatible(stored, expected) && stored && expected
		? { stored, expected }
		: null;

const describeSearchMode = (
	status: EmbeddingStatus,
	mismatch: DimensionMismatch | null,
	hydrating = false,
	modelMismatch: ModelMismatch | null = null,
): string => {
	if (hydrating && !status.storageHasVectors) {
		return 'Hydrating bundled 768-d vectors in background — lexical FTS5 active now, hybrid ready in a few seconds';
	}

	if (mismatch) {
		return `Hybrid (dimension mismatch) — ${mismatch.stored}-d vectors stored but queries embed at ${mismatch.expected}-d, so semantic scoring is skipped and results stay lexical; set APPLE_DOCS_EMBEDDING_DIMENSIONS=${mismatch.stored} to keep them, or "npm run embed-index -- --force" to re-embed`;
	}

	if (modelMismatch) {
		return `Hybrid (model mismatch) — vectors built with "${modelMismatch.stored}" cannot be scored against "${modelMismatch.expected}", so results stay lexical; match APPLE_DOCS_EMBEDDING_PROVIDER or run "npm run embed-index -- --force"`;
	}

	if (status.hybridEnabled) {
		return `Hybrid (SQLite FTS5 + embeddings) — ${status.semanticItemCount} semantic items (threshold ${status.threshold})`;
	}

	const storage = status.storageHasVectors
		? `${status.semanticItemCount} of ${status.threshold} semantic items embedded`
		: `no semantic items embedded (threshold ${status.threshold})`;

	return `Lexical only (SQLite FTS5) — ${storage}; run "npm run embed-index" or "npm run download-vectors" to enable hybrid`;
};

export const buildVersionHandler =
	(context?: ServerContext) => async (): Promise<ToolResponse> => {
		context?.db?.assertNotReplaced();
		const meta = getIndexMetadata(context);
		const mismatch = resolveDimensionMismatch(
			meta.storedVectorWidth,
			context?.searchEngine?.embeddingProvider?.dimensions ?? 0,
		);
		const modelMismatch = resolveModelMismatch(
			meta.storedEmbeddingModel,
			context?.searchEngine?.embeddingProvider?.modelId,
		);

		const text = `Apple Doc MCP Server Version & Index Information:

📦 Server Version: ${meta.version}
🏷️ Server Name: ${meta.serverName}
📝 Description: ${packageJson.description}
📁 Database Path: ${meta.dbPath}
📊 Indexed Symbols: ${meta.symbolCount}
📦 Indexed Frameworks: ${meta.indexedFrameworks.length} (${meta.indexedFrameworks.join(', ')})${meta.crossReferenceFrameworks.length > 0 ? `\n🔗 Cross-reference targets: ${meta.crossReferenceFrameworks.join(', ')}` : ''}
🕒 Snapshot Built At: ${describeFreshness(meta.freshness)}
🔎 Search Capability: ${describeSearchMode(meta.embeddingStatus, mismatch, meta.hydrating, modelMismatch)}
👤 Author: ${packageJson.author}
🔗 Repository: ${packageJson.repository?.url ?? 'N/A'}`;

		return {
			content: [
				{
					type: 'text',
					text,
				},
			],
		};
	};

/**
 * `index_info` answers a different question than `get_version`: not "what is
 * this server" but "can I trust this index?". It reports the two data defects
 * that silently corrupt search results (unclassified kinds, mis-attributed
 * frameworks) plus the real search mode and freshness provenance.
 */
export const buildIndexInfoHandler =
	(context?: ServerContext) => async (): Promise<ToolResponse> => {
		context?.db?.assertNotReplaced();
		const meta = getIndexMetadata(context);
		const topKinds = meta.kindDistribution.slice(0, 12);
		const remainingKinds = meta.kindDistribution.slice(12);
		const remainingCount = remainingKinds.reduce((sum, e) => sum + e.count, 0);
		const kindLines =
			topKinds.length > 0
				? [
						...topKinds.map(
							(entry) => `   • ${entry.kind}: ${entry.count.toLocaleString()}`,
						),
						...(remainingKinds.length > 0
							? [
									`   • ...and ${remainingKinds.length} more kinds (${remainingCount.toLocaleString()} symbols: ${remainingKinds.map((e) => `${e.kind} (${e.count})`).join(', ')})`,
								]
							: []),
					]
				: ['   • (no symbols indexed)'];

		const unknownShare =
			meta.symbolCount > 0
				? ((meta.unknownKindCount / meta.symbolCount) * 100).toFixed(2)
				: '0.00';

		// A corrupt file yields zero rows and zero mismatches from the same
		// swallowed errors that made doctor print five greens. Do not restate
		// those zeros as "OK": the index has to be readable before any of it
		// means anything.
		const db = context?.db;
		const readability = db?.probeReadability();
		const unreadableReason =
			readability?.readable === false ? readability.error : null;

		const filterReliability = unreadableReason
			? `UNKNOWN — the index is unreadable (${unreadableReason}), so no kind can be filtered. Run "npm run build:index" to rebuild it.`
			: meta.unknownKindCount === 0
				? 'OK — every row carries a classified kind, so symbolType filters are exact.'
				: `DEGRADED — ${meta.unknownKindCount} rows (${unknownShare}%) carry no classified kind. A symbolType filter cannot match them, so filtered results may silently exclude valid symbols. Run "npm run repair-index -- --apply" to backfill kinds.`;

		const attribution = unreadableReason
			? `UNKNOWN — the index is unreadable (${unreadableReason}), so attribution cannot be checked. Run "npm run build:index" to rebuild it.`
			: meta.frameworkMismatchCount === 0
				? 'OK — every row is attributed to the framework named by its own path.'
				: `DEGRADED — ${meta.frameworkMismatchCount} rows are attributed to a framework that contradicts their path, producing cross-framework false positives and framework-scoped false negatives. Run "npm run repair-index -- --apply" to re-attribute them.`;

		// Same checks as `npm run doctor`, so the tool and the CLI cannot drift.
		// Cheap by design: `runDoctor` is pure apart from existsSync/statSync.
		const expectedDimensions =
			context?.searchEngine?.embeddingProvider?.dimensions ?? 0;
		const mismatch = resolveDimensionMismatch(
			meta.storedVectorWidth,
			expectedDimensions,
		);
		const modelMismatch = resolveModelMismatch(
			meta.storedEmbeddingModel,
			context?.searchEngine?.embeddingProvider?.modelId,
		);
		const doctor = db
			? runDoctor({
					db,
					dbPath: db.dbPath,
					provider:
						context.searchEngine?.embeddingProvider ?? UNAVAILABLE_PROVIDER,
					nodeVersion: process.version,
					hydrating: meta.hydrating,
				})
			: undefined;

		const doctorResult = doctor
			? doctor.failures === 0
				? `all checks passed (${formatCount(doctor.warnings, 'warning')})`
				: `${formatCount(doctor.failures, 'failure')} — run \`npm run doctor\``
			: 'unavailable (no database)';

		const dimensionLine =
			meta.storedVectorWidth !== null
				? `\n• **Vector dimensions:** ${meta.storedVectorWidth}-d stored vs ${expectedDimensions > 0 ? `${expectedDimensions}-d` : 'unknown'} expected${mismatch ? ' — MISMATCH: semantic scoring is skipped, results stay lexical. Set APPLE_DOCS_EMBEDDING_DIMENSIONS to the stored width, or run `npm run embed-index -- --force` to re-embed' : ''}`
				: '';
		const modelLine = meta.storedEmbeddingModel
			? `\n• **Embedding model:** ${meta.storedEmbeddingModel}${modelMismatch ? ` vs ${modelMismatch.expected} active — MISMATCH: cross-model cosine scoring is skipped, results stay lexical` : ''}`
			: '';
		// "hybrid" on row count alone is the claim the review rejected: the mode
		// label must carry the mismatch, not just the dimension line.
		const modeLabel = meta.hydrating
			? 'hydrating'
			: mismatch
				? `${meta.embeddingStatus.mode} (dimension mismatch)`
				: modelMismatch
					? `${meta.embeddingStatus.mode} (model mismatch)`
					: meta.embeddingStatus.mode;

		// The actions section is derived from the report, not hand-written: the
		// old list drifted (it said build:index enabled hybrid; embed-index does).
		const recommendedActions = doctor
			? [
					...new Set(
						doctor.checks
							.filter((c) => c.nextStep.trim())
							.map((c) => c.nextStep.trim()),
					),
				]
			: [];
		const actionLines =
			recommendedActions.length > 0
				? recommendedActions.map((step) => `• ${step}`).join('\n')
				: doctor
					? '• No action required — every check passed'
					: '• `npm run doctor` — no index was open to diagnose';

		const text = `# Apple Docs Index Health

**Server:** ${meta.serverName} v${meta.version}
**Database:** ${meta.dbPath}
**Symbols:** ${meta.symbolCount}
**Frameworks indexed:** ${meta.indexedFrameworks.length} (${meta.indexedFrameworks.join(', ')})${meta.crossReferenceFrameworks.length > 0 ? `\n**Cross-reference targets:** ${meta.crossReferenceFrameworks.length} (${meta.crossReferenceFrameworks.join(', ')}) — linked from indexed pages, not crawled` : ''}

## Freshness
• **Snapshot:** ${describeFreshness(meta.freshness)}
• **Provenance:** ${FRESHNESS_SOURCE_LABELS[meta.freshness.source]}
• **Stale snapshot warning:** ${meta.freshness.source === 'meta' ? 'none — build stamp present' : 'no build stamp; APIs newer than this time may be missing'}

## Search Capability
• **Mode:** ${modeLabel}
• **Hybrid enabled:** ${meta.embeddingStatus.hybridEnabled ? 'yes' : 'no'}
• **Semantic items:** ${meta.embeddingStatus.semanticItemCount} / threshold ${meta.embeddingStatus.threshold}${dimensionLine}${modelLine}
• **Note:** vector storage ${meta.embeddingStatus.storageHasVectors ? 'holds vectors' : 'is empty'}; hybrid fusion only engages at or above the threshold, and only when the stored width matches the query width.

## Kind Distribution
${kindLines.join('\n')}

## Index Health
• **Unclassified symbols (unknown kind):** ${meta.unknownKindCount} (${unknownShare}%)
• **Framework/path mismatches:** ${meta.frameworkMismatchCount}
• **Kind filter reliability:** ${filterReliability}
• **Framework attribution:** ${attribution}

## Doctor
• **Result:** ${doctorResult}

## Recommended Actions
${actionLines}`;

		return {
			content: [
				{
					type: 'text',
					text,
				},
			],
		};
	};
