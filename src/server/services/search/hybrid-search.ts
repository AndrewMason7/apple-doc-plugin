import { AppleDocsDB, DbSymbol } from '../../db/database.js';
import {
	DEFAULT_EMBEDDING_DIMENSIONS,
	GeminiSemanticSearch,
	SemanticMatch,
} from './semantic-search.js';
import type { EmbeddingProvider } from './embedding-provider.js';

/**
 * Pick the cosine floor for a provider. Each embedding model has its own score
 * distribution, so a floor tuned against one model quietly admits noise when
 * swapped for another.
 */
export const resolveMinSimilarity = (
	provider: EmbeddingProvider,
	preferSemantic: boolean,
): number => {
	if (preferSemantic) {
		return provider.minSimilarityPreferred ?? 0.55;
	}
	return provider.minSimilarity ?? 0.65;
};
import { resolveEmbeddingProvider } from './provider-factory.js';

export const STOPWORDS = new Set([
	'how',
	'what',
	'when',
	'where',
	'why',
	'which',
	'who',
	'do',
	'does',
	'did',
	'can',
	'could',
	'should',
	'i',
	'my',
	'me',
	'we',
	'you',
	'the',
	'a',
	'an',
	'to',
	'in',
	'on',
	'of',
	'for',
	'with',
	'that',
	'this',
	'is',
	'are',
	'be',
	'from',
	'it',
	'and',
	'or',
	'but',
	'not',
	'while',
	'after',
	'before',
]);

/** A sentence is not a symbol name: it needs ≥3 words, no glob, and must read like prose. */
export const isNaturalLanguageQuery = (query: string): boolean => {
	const trimmed = query.trim();
	if (!trimmed || trimmed.includes('*')) return false;
	const words = trimmed.split(/\s+/);
	if (words.length < 3) return false;
	const stopHits = words.filter((word) =>
		STOPWORDS.has(word.toLowerCase()),
	).length;
	return words.length >= 6 || stopHits >= 2;
};

export interface SearchOptions {
	framework?: string;
	limit?: number;
	preferSemantic?: boolean;
	lexicalOnly?: boolean;
	minSemanticItems?: number;
}

export interface SearchResultItem extends DbSymbol {
	score: number;
	source: 'fts' | 'semantic' | 'hybrid';
	mediaUrl?: string;
	mediaType?: string;
}

export interface HybridSearchEngineOptions {
	apiKey?: string | null;
	modelName?: string;
	baseUrl?: string;
	googleAuth?: any;
	expectedDimensions?: number;
	minSemanticItems?: number;
	embeddingProvider?: EmbeddingProvider;
}

export class HybridSearchEngine {
	public readonly embeddingProvider: EmbeddingProvider;
	public readonly semanticSearch: GeminiSemanticSearch;
	public readonly minSemanticItems: number;
	/**
	 * Width pairs already reported. The comparison is a corpus-level fact, so a
	 * stale 3072-d corpus must cost one line per process, not one line per
	 * stored row (19,473 rows used to mean 19,473 stderr lines per query).
	 */
	private readonly reportedWidthMismatches = new Set<string>();

	hasSemanticAuth(): boolean {
		return this.embeddingProvider.isAvailable();
	}

	isCircuitOpen(): boolean {
		if (
			'isCircuitOpen' in this.embeddingProvider &&
			typeof (this.embeddingProvider as any).isCircuitOpen === 'function'
		) {
			return (this.embeddingProvider as any).isCircuitOpen();
		}
		return this.semanticSearch.isCircuitOpen();
	}

	constructor(
		private readonly db: AppleDocsDB,
		options: HybridSearchEngineOptions = {},
	) {
		if (options.embeddingProvider) {
			this.embeddingProvider = options.embeddingProvider;
			this.semanticSearch =
				options.embeddingProvider instanceof GeminiSemanticSearch
					? options.embeddingProvider
					: new GeminiSemanticSearch(
							options.apiKey,
							options.modelName,
							options.baseUrl,
							options.googleAuth,
							options.expectedDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS,
						);
		} else if (
			options.apiKey !== undefined ||
			options.googleAuth !== undefined ||
			options.baseUrl !== undefined ||
			options.modelName !== undefined
		) {
			this.semanticSearch = new GeminiSemanticSearch(
				options.apiKey,
				options.modelName,
				options.baseUrl,
				options.googleAuth,
				options.expectedDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS,
			);
			this.embeddingProvider = this.semanticSearch;
		} else {
			this.embeddingProvider = resolveEmbeddingProvider();
			this.semanticSearch =
				this.embeddingProvider instanceof GeminiSemanticSearch
					? this.embeddingProvider
					: new GeminiSemanticSearch(
							options.apiKey,
							options.modelName,
							options.baseUrl,
							options.googleAuth,
							options.expectedDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS,
						);
		}
		this.minSemanticItems = options.minSemanticItems ?? 100;
	}

	/**
	 * Report an unusable vector width exactly once per width pair, with both
	 * ways out. Returns nothing: the caller skips the semantic pass.
	 */
	private reportWidthMismatch(
		storedWidth: number,
		queryWidth: number,
		mismatchedItems: number,
	): void {
		const key = `${storedWidth}->${queryWidth}`;
		if (this.reportedWidthMismatches.has(key)) return;
		this.reportedWidthMismatches.add(key);
		console.warn(
			`Warning: semantic vector dimension mismatch — ${mismatchedItems} stored vector(s) are ${storedWidth}-d but the query embedding is ${queryWidth}-d, so cosine scores are undefined. ` +
				`set APPLE_DOCS_EMBEDDING_DIMENSIONS=${storedWidth} to keep your existing vectors, or run npm run embed-index -- --force to re-embed at ${queryWidth}. ` +
				'Skipping the semantic pass; results stay lexical until one of those is done.',
		);
	}

	searchSemanticWithVector(
		queryVec: Float32Array,
		framework?: string,
		limit = 10,
		minSimilarity = 0.65,
	): SemanticMatch[] {
		const items = this.db.getSemanticItems(framework);
		const matches: SemanticMatch[] = [];

		let queryNormSq = 0.0;
		for (let i = 0; i < queryVec.length; i++) {
			queryNormSq += queryVec[i] * queryVec[i];
		}
		const queryNorm = Math.sqrt(queryNormSq);
		if (queryNorm === 0) return [];

		// Compare widths once, before any cosine work. A partial mismatch is
		// still worth one line; a total mismatch means the pass cannot produce a
		// single match, so skip it instead of scanning the corpus for nothing.
		const widths = new Map<number, number>();
		for (const item of items) {
			const width = item.embedding.length;
			widths.set(width, (widths.get(width) ?? 0) + 1);
		}
		const comparableCount = widths.get(queryVec.length) ?? 0;
		const mismatchedCount = items.length - comparableCount;
		if (mismatchedCount > 0) {
			const storedWidth = Math.max(
				...[...widths.keys()].filter((width) => width !== queryVec.length),
			);
			this.reportWidthMismatch(storedWidth, queryVec.length, mismatchedCount);
		}
		if (comparableCount === 0) return [];

		for (const item of items) {
			if (item.embedding.length !== queryVec.length) continue;

			let itemNorm = item.norm;
			if (itemNorm === undefined) {
				let normSq = 0.0;
				for (let i = 0; i < item.embedding.length; i++) {
					normSq += item.embedding[i] * item.embedding[i];
				}
				itemNorm = Math.sqrt(normSq);
			}

			const similarity = this.semanticSearch.cosineSimilarityWithNorm(
				queryVec,
				queryNorm,
				item.embedding,
				itemNorm,
			);
			if (similarity >= minSimilarity) {
				matches.push({
					id: item.id,
					framework: item.framework,
					title: item.title,
					kind: item.kind,
					summary: item.summary,
					path: item.path,
					mediaUrl: item.mediaUrl,
					mediaType: item.mediaType,
					similarity,
				});
			}
		}

		return matches.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
	}

	async search(
		query: string,
		options: SearchOptions = {},
	): Promise<SearchResultItem[]> {
		const limit = options.limit || 20;
		// A prose query is not a symbol name, so lexical noise beats the vector
		// hit it happens to contain. Lean semantic for sentences; an explicit
		// flag from the caller still wins.
		const preferSemantic =
			options.preferSemantic ?? isNaturalLanguageQuery(query);
		const ftsResults = this.db.queryFTS(query, options.framework, limit * 2);

		// Exact symbol booster
		const normalizedQuery = query.trim().toLowerCase();
		const scoredFTS: SearchResultItem[] = ftsResults.map((item) => {
			const isExact = item.title.toLowerCase() === normalizedQuery;
			return {
				...item,
				score: isExact ? item.score + 100 : item.score,
				source: 'fts',
			};
		});

		// Pure lexical search: skip Gemini vector embeddings completely
		if (options.lexicalOnly) {
			return scoredFTS.sort((a, b) => b.score - a.score).slice(0, limit);
		}

		// Check if semantic index has enough vectors (symbols require build:index; <100 means only overview/media rows exist)
		const minSemanticItems = options.minSemanticItems ?? this.minSemanticItems;
		const semanticItemCount = this.db.getSemanticItemCount();
		if (semanticItemCount < minSemanticItems) {
			return scoredFTS.sort((a, b) => b.score - a.score).slice(0, limit);
		}

		// Check if semantic search is available
		if (this.embeddingProvider.isAvailable()) {
			const queryVec = await this.embeddingProvider.embedQuery(query);
			if (queryVec) {
				const minSim = resolveMinSimilarity(
					this.embeddingProvider,
					preferSemantic,
				);
				const semanticMatches = this.searchSemanticWithVector(
					queryVec,
					options.framework,
					limit,
					minSim,
				);

				if (semanticMatches.length > 0) {
					// Reciprocal Rank Fusion (RRF)
					const rrfScores = new Map<
						string,
						{ item: SearchResultItem; rrf: number }
					>();
					const k = 60;
					const ftsWeight = preferSemantic ? 0.7 : 1.0;
					const semWeight = preferSemantic ? 1.8 : 1.0;

					// Rank FTS items
					scoredFTS
						.sort((a, b) => b.score - a.score)
						.forEach((item, rank) => {
							const rrf = (1.0 / (k + rank + 1)) * ftsWeight;
							rrfScores.set(item.id, { item, rrf });
						});

					// Rank Semantic items
					semanticMatches.forEach((sem, rank) => {
						const rrfBonus = (1.0 / (k + rank + 1)) * semWeight;
						const existing = rrfScores.get(sem.id);
						if (existing) {
							existing.rrf += rrfBonus;
							existing.item.source = 'hybrid';
							if (sem.mediaUrl && !existing.item.mediaUrl) {
								existing.item.mediaUrl = sem.mediaUrl;
								existing.item.mediaType = sem.mediaType;
							}
						} else {
							const semItem: SearchResultItem = {
								id: sem.id,
								framework: sem.framework,
								title: sem.title,
								kind: sem.kind,
								abstract: sem.summary,
								path: sem.path,
								platforms: [],
								score: sem.similarity * 50,
								source: 'semantic',
								mediaUrl: sem.mediaUrl,
								mediaType: sem.mediaType,
							};
							rrfScores.set(sem.id, { item: semItem, rrf: rrfBonus });
						}
					});

					return [...rrfScores.values()]
						.sort((a, b) => b.rrf - a.rrf)
						.slice(0, limit)
						.map((entry) => entry.item);
				}
			}
		}

		// Default to scored FTS results sorted by score
		return scoredFTS.sort((a, b) => b.score - a.score).slice(0, limit);
	}
}
