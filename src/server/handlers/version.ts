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
import { runDoctor } from '../services/doctor.js';
import type { EmbeddingProvider } from '../services/search/embedding-provider.js';

/**
 * `index_info` is read-only and runs on every call inside the MCP server, so it
 * must never construct a real embedding provider (that can load a 300 MB GGUF).
 * When the caller has no live search engine we hand the doctor an honest
 * "nothing configured" stub instead.
 */
const UNAVAILABLE_PROVIDER: EmbeddingProvider = {
	id: 'unavailable',
	dimensions: 0,
	isAvailable: () => false,
	embedQuery: async () => null,
	embedDocument: async () => null,
};

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

const describeSearchMode = (status: EmbeddingStatus): string => {
	if (status.hybridEnabled) {
		return `Hybrid (SQLite FTS5 + embeddings) — ${status.semanticItemCount} semantic items (threshold ${status.threshold})`;
	}

	const storage = status.storageHasVectors
		? `${status.semanticItemCount} of ${status.threshold} semantic items embedded`
		: `no semantic items embedded (threshold ${status.threshold})`;

	return `Lexical only (SQLite FTS5) — ${storage}; run "npm run build:index" with embedding credentials to enable hybrid`;
};

export const buildVersionHandler =
	(context?: ServerContext) => async (): Promise<ToolResponse> => {
		const meta = getIndexMetadata(context);

		const text = `Apple Doc MCP Server Version & Index Information:

📦 Server Version: ${meta.version}
🏷️ Server Name: ${meta.serverName}
📝 Description: ${packageJson.description}
📁 Database Path: ${meta.dbPath}
📊 Indexed Symbols: ${meta.symbolCount}
📦 Indexed Frameworks: ${meta.indexedFrameworks.length} (${meta.indexedFrameworks.join(', ')})${meta.crossReferenceFrameworks.length > 0 ? `\n🔗 Cross-reference targets: ${meta.crossReferenceFrameworks.join(', ')}` : ''}
🕒 Snapshot Built At: ${describeFreshness(meta.freshness)}
🔎 Search Capability: ${describeSearchMode(meta.embeddingStatus)}
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
		const meta = getIndexMetadata(context);
		const topKinds = meta.kindDistribution.slice(0, 12);
		const kindLines =
			topKinds.length > 0
				? topKinds.map((entry) => `   • ${entry.kind}: ${entry.count}`)
				: ['   • (no symbols indexed)'];

		const unknownShare =
			meta.symbolCount > 0
				? ((meta.unknownKindCount / meta.symbolCount) * 100).toFixed(2)
				: '0.00';

		const filterReliability =
			meta.unknownKindCount === 0
				? 'OK — every row carries a classified kind, so symbolType filters are exact.'
				: `DEGRADED — ${meta.unknownKindCount} rows (${unknownShare}%) carry no classified kind. A symbolType filter cannot match them, so filtered results may silently exclude valid symbols. Run "npm run repair-index -- --apply" to backfill kinds.`;

		const attribution =
			meta.frameworkMismatchCount === 0
				? 'OK — every row is attributed to the framework named by its own path.'
				: `DEGRADED — ${meta.frameworkMismatchCount} rows are attributed to a framework that contradicts their path, producing cross-framework false positives and framework-scoped false negatives. Run "npm run repair-index -- --apply" to re-attribute them.`;

		// Same checks as `npm run doctor`, so the tool and the CLI cannot drift.
		// Cheap by design: `runDoctor` is pure apart from existsSync/statSync.
		const db = context?.db;
		const doctor = db
			? runDoctor({
					db,
					dbPath: db.dbPath,
					provider:
						context.searchEngine?.embeddingProvider ?? UNAVAILABLE_PROVIDER,
					nodeVersion: process.version,
				})
			: undefined;

		const doctorResult = doctor
			? doctor.failures === 0
				? `all checks passed (${doctor.warnings} warning${doctor.warnings === 1 ? '' : 's'})`
				: `${doctor.failures} failure(s) — run \`npm run doctor\``
			: 'unavailable (no database)';

		const text = `# Apple Docs Index Health

**Server:** ${meta.serverName} v${meta.version}
**Database:** ${meta.dbPath}
**Symbols:** ${meta.symbolCount}
**Frameworks indexed:** ${meta.indexedFrameworks.length} (${meta.indexedFrameworks.join(', ')})${meta.crossReferenceFrameworks.length > 0 ? `\n**Cross-reference targets:** ${meta.crossReferenceFrameworks.length} (${meta.crossReferenceFrameworks.join(', ')}) — linked from indexed pages, not crawled` : ''}

## Freshness
• **Snapshot:** ${describeFreshness(meta.freshness)}
• **Provenance:** ${meta.freshness.source}
• **Stale snapshot warning:** ${meta.freshness.source === 'meta' ? 'none — build stamp present' : 'no build stamp; APIs newer than this time may be missing'}

## Search Capability
• **Mode:** ${meta.embeddingStatus.mode}
• **Hybrid enabled:** ${meta.embeddingStatus.hybridEnabled ? 'yes' : 'no'}
• **Semantic items:** ${meta.embeddingStatus.semanticItemCount} / threshold ${meta.embeddingStatus.threshold}
• **Note:** vector storage ${meta.embeddingStatus.storageHasVectors ? 'holds vectors' : 'is empty'}; hybrid fusion only engages at or above the threshold, so a populated store does not imply hybrid search.

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
${meta.unknownKindCount > 0 || meta.frameworkMismatchCount > 0 ? '• `npm run repair-index -- --apply` to fix kinds and attribution in place' : '• No repair required'}
${meta.embeddingStatus.hybridEnabled ? '• Hybrid search is active' : '• `npm run build:index` with embedding credentials to enable hybrid search'}`;

		return {
			content: [
				{
					type: 'text',
					text,
				},
			],
		};
	};
