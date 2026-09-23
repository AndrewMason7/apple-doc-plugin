import { GeminiSemanticSearch } from './semantic-search.js';
export class HybridSearchEngine {
    db;
    semanticSearch;
    constructor(db, options = {}) {
        this.db = db;
        this.semanticSearch = new GeminiSemanticSearch(options.apiKey);
    }
    searchSemanticWithVector(queryVec, framework, limit = 10, minSimilarity = 0.65) {
        const items = this.db.getSemanticItems(framework);
        const matches = [];
        for (const item of items) {
            const similarity = this.semanticSearch.cosineSimilarity(queryVec, item.embedding);
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
    async search(query, options = {}) {
        const limit = options.limit || 20;
        const ftsResults = this.db.queryFTS(query, options.framework, limit * 2);
        // Exact symbol booster
        const normalizedQuery = query.trim().toLowerCase();
        const scoredFTS = ftsResults.map((item) => {
            const isExact = item.title.toLowerCase() === normalizedQuery;
            return {
                ...item,
                score: isExact ? item.score + 100 : item.score,
                source: 'fts',
            };
        });
        // Check if semantic search is available
        if (this.semanticSearch.hasApiKey()) {
            const queryVec = await this.semanticSearch.embedQuery(query);
            if (queryVec) {
                const semanticMatches = this.searchSemanticWithVector(queryVec, options.framework, limit);
                if (semanticMatches.length > 0) {
                    // Reciprocal Rank Fusion (RRF)
                    const rrfScores = new Map();
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
                        }
                        else {
                            const semItem = {
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
//# sourceMappingURL=hybrid-search.js.map