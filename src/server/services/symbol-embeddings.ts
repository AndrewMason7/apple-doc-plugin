import type { AppleDocsDB } from '../db/database.js';
import type { EmbeddingProvider } from './search/embedding-provider.js';

/** A symbol row shaped for embedding (subset of the symbols table). */
export interface EmbeddingCandidate {
	id: string;
	title: string;
	kind: string;
	framework: string;
	abstract: string;
	path: string;
}

export interface EmbedSymbolsOptions {
	/** Embed every symbol, not just primary types + documented ones. */
	all?: boolean;
	/** Stop after N symbols (useful for smoke tests). Default: no limit. */
	limit?: number;
	/** Log cadence, in symbols. Default 250. */
	batchSize?: number;
	/** Re-embed symbols that already have a vector (use after changing doc text). */
	force?: boolean;
	onProgress?: (progress: {
		done: number;
		total: number;
		embedded: number;
	}) => void;
}

export interface EmbedSymbolsResult {
	total: number;
	embedded: number;
	skipped: number;
	failed: number;
}

/**
 * Semantic items are keyed separately from symbols so a rebuild of the symbol
 * layer never collides with technology-card or media vectors.
 */
export const semanticIdForSymbol = (symbolId: string): string =>
	`sym-${symbolId}`;

/**
 * Document text handed to the embedding model.
 *
 * Apple's abstract IS the document — the provider already prefixes the title
 * (`title: X | text: Y`), so adding a classification headline on top dilutes a
 * short abstract and measurably lowers its cosine against intent-style queries
 * (`task` fell from 0.7034 to 0.6725, dropping under the local floor). Only fall
 * back to the headline when there is no abstract at all.
 */
export function buildSymbolEmbeddingText(sym: {
	title: string;
	kind: string;
	framework: string;
	abstract?: string | null;
}): string {
	const abstract = (sym.abstract ?? '').trim();
	if (abstract) return abstract;
	return `${sym.title} — ${sym.kind} in ${sym.framework}.`;
}

/**
 * Default selection: primary types (the symbols people actually search for
 * conceptually) plus any symbol Apple documented. Undocumented members with no
 * abstract are skipped — a bare signature embeds to noise, not meaning.
 */
export function selectEmbeddingCandidates(
	db: AppleDocsDB,
	options: { all?: boolean } = {},
): EmbeddingCandidate[] {
	const rows: EmbeddingCandidate[] = options.all
		? db.getAllSymbolsForEmbedding()
		: db.getEmbeddingCandidateSymbols();

	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		kind: row.kind,
		framework: row.framework,
		abstract: row.abstract ?? '',
		path: row.path,
	}));
}

/**
 * Embed the symbol layer into `semantic_items`, resuming automatically: items
 * that already exist are skipped, so an interrupted run can be restarted.
 */
export async function embedSymbols(
	db: AppleDocsDB,
	provider: EmbeddingProvider,
	options: EmbedSymbolsOptions = {},
): Promise<EmbedSymbolsResult> {
	if (!provider.isAvailable()) {
		throw new Error(
			'No embedding provider available: install a local GGUF model (APPLE_DOCS_EMBEDDING_MODEL_PATH) or configure embedding credentials.',
		);
	}
	if (provider.dimensions <= 0) {
		throw new Error(
			`Embedding provider "${provider.id}" reports ${provider.dimensions} dimensions; refusing to write unusable vectors.`,
		);
	}

	const batchSize = options.batchSize && options.batchSize > 0 ? options.batchSize : 250;
	const candidates = selectEmbeddingCandidates(db, { all: options.all });
	const existing = db.getSemanticItemIds();

	let pending = options.force
		? [...candidates]
		: candidates.filter(
				(candidate) => !existing.has(semanticIdForSymbol(candidate.id)),
			);
	const skipped = options.force ? 0 : candidates.length - pending.length;

	if (typeof options.limit === 'number' && options.limit > 0) {
		pending = pending.slice(0, options.limit);
	}

	let embedded = 0;
	let failed = 0;

	const persist = (candidate: EmbeddingCandidate, vector: Float32Array): void => {
		db.insertSemanticItem({
			id: semanticIdForSymbol(candidate.id),
			framework: candidate.framework,
			title: candidate.title,
			kind: candidate.kind,
			summary: candidate.abstract || candidate.title,
			path: candidate.path,
			embedding: vector,
		});
	};

	const report = (done: number): void => {
		if (done % batchSize === 0 || done === pending.length) {
			options.onProgress?.({ done, total: pending.length, embedded });
		}
	};

	const canBatch =
		typeof provider.embedDocuments === 'function' &&
		provider.id !== 'local-gguf';

	if (canBatch) {
		// Providers with a batch endpoint: one request per API_BATCH_LIMIT items.
		const API_BATCH_LIMIT = 100;
		let done = 0;

		for (let start = 0; start < pending.length; start += API_BATCH_LIMIT) {
			const chunk = pending.slice(start, start + API_BATCH_LIMIT);
			let vectors: Array<Float32Array | null> = new Array(chunk.length).fill(
				null,
			);

			try {
				vectors =
					(await provider.embedDocuments!(
						chunk.map((candidate) => ({
							content: buildSymbolEmbeddingText(candidate),
							title: candidate.title,
						})),
					)) ?? vectors;
			} catch (err) {
				console.error(
					`   ⚠ batch failed (${chunk.length} items): ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			for (const [offset, candidate] of chunk.entries()) {
				let vector = vectors[offset] ?? null;

				// Retry a failed slot individually so one bad item cannot sink a batch.
				if (!vector || vector.length !== provider.dimensions) {
					try {
						vector = await provider.embedDocument(
							buildSymbolEmbeddingText(candidate),
							candidate.title,
						);
					} catch (err) {
						vector = null;
						console.error(
							`   ⚠ ${candidate.id}: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				}

				if (!vector || vector.length !== provider.dimensions) {
					failed++;
				} else {
					persist(candidate, vector);
					embedded++;
				}

				done++;
				report(done);
			}
		}
	} else {
		for (const [index, candidate] of pending.entries()) {
			const text = buildSymbolEmbeddingText(candidate);
			let vector: Float32Array | null = null;
			try {
				vector = await provider.embedDocument(text, candidate.title);
			} catch (err) {
				failed++;
				console.error(
					`   ⚠ ${candidate.id}: ${err instanceof Error ? err.message : String(err)}`,
				);
				continue;
			}

			if (!vector || vector.length !== provider.dimensions) {
				failed++;
				continue;
			}

			persist(candidate, vector);
			embedded++;
			report(index + 1);
		}
	}

	return { total: candidates.length, embedded, skipped, failed };
}
