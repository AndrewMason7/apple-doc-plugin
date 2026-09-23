import { AppleDocsDB, DbSymbol } from '../../db/database.js';
import { SemanticMatch } from './semantic-search.js';
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
export declare class HybridSearchEngine {
    private readonly db;
    private semanticSearch;
    constructor(db: AppleDocsDB, options?: {
        apiKey?: string | null;
    });
    searchSemanticWithVector(queryVec: Float32Array, framework?: string, limit?: number, minSimilarity?: number): SemanticMatch[];
    search(query: string, options?: SearchOptions): Promise<SearchResultItem[]>;
}
