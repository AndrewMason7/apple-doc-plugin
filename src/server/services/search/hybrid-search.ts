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

		for (const item of items) {
			let itemNorm = item.norm;
			if (itemNorm === undefined) {
				let normSq = 0.0;
				for (let i = 0; i < item.embedding.length; i++) {
					normSq += item.embedding[i] * item.embedding[i];
				}
				itemNorm = Math.sqrt(normSq);
			}

			if (item.embedding.length !== queryVec.length) {
				console.warn(
					`Warning: Semantic vector dimension mismatch: item "${item.id}" has ${item.embedding.length} dims, query has ${queryVec.length} dims.`,
				);
				continue;
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
					Boolean(options.preferSemantic),
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
					const ftsWeight = options.preferSemantic ? 0.7 : 1.0;
					const semWeight = options.preferSemantic ? 1.8 : 1.0;

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
