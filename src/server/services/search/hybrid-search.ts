import { AppleDocsDB, DbSymbol } from '../../db/database.js';
import { GeminiSemanticSearch, SemanticMatch } from './semantic-search.js';

export interface SearchOptions {
	framework?: string;
	limit?: number;
}

export interface SearchResultItem extends DbSymbol {
	score: number;
	source: 'fts' | 'semantic' | 'hybrid';
	mediaUrl?: string;
	mediaType?: string;
}

export class HybridSearchEngine {
	private semanticSearch: GeminiSemanticSearch;

	constructor(
		private readonly db: AppleDocsDB,
		options: {
			apiKey?: string | null;
			modelName?: string;
			baseUrl?: string;
			googleAuth?: any;
			expectedDimensions?: number;
		} = {},
	) {
		this.semanticSearch = new GeminiSemanticSearch(
			options.apiKey,
			options.modelName,
			options.baseUrl,
			options.googleAuth,
			options.expectedDimensions ?? 3072,
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

		// Check if semantic search is available (API key or ADC)
		if (this.semanticSearch.hasAuth()) {
			const queryVec = await this.semanticSearch.embedQuery(query);
			if (queryVec) {
				const semanticMatches = this.searchSemanticWithVector(
					queryVec,
					options.framework,
					limit,
				);

				if (semanticMatches.length > 0) {
					// Reciprocal Rank Fusion (RRF)
					const rrfScores = new Map<
						string,
						{ item: SearchResultItem; rrf: number }
					>();
					const k = 60;

					// Rank FTS items
					scoredFTS
						.sort((a, b) => b.score - a.score)
						.forEach((item, rank) => {
							const rrf = 1.0 / (k + rank + 1);
							rrfScores.set(item.id, { item, rrf });
						});

					// Rank Semantic items
					semanticMatches.forEach((sem, rank) => {
						const rrfBonus = 1.0 / (k + rank + 1);
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
