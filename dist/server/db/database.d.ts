import Database from 'better-sqlite3';
export interface DbSymbol {
    id: string;
    framework: string;
    title: string;
    kind: string;
    abstract: string;
    path: string;
    platforms: string[];
    isPrimaryType?: boolean;
}
export interface FTSResult extends DbSymbol {
    score: number;
}
export interface SemanticItem {
    id: string;
    framework: string;
    title: string;
    kind: string;
    summary: string;
    path: string;
    mediaUrl?: string;
    mediaType?: string;
    embedding: Float32Array;
}
export declare class AppleDocsDB {
    private db;
    constructor(dbPath: string, options?: Database.Options);
    insertSymbol(sym: DbSymbol): void;
    insertSemanticItem(item: SemanticItem): void;
    getSemanticItems(framework?: string): SemanticItem[];
    queryFTS(query: string, framework?: string, limit?: number): FTSResult[];
    private queryLike;
    getSymbolByPath(path: string): DbSymbol | null;
    getFrameworks(): string[];
    close(): void;
}
