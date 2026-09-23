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
    norm?: number;
}
export declare function deserializeFloat32Array(buf: Buffer): Float32Array | null;
export declare class AppleDocsDB {
    private db;
    private vectorCache;
    constructor(dbPath: string, options?: Database.Options);
    rebuildFTS(): void;
    insertSymbol(sym: DbSymbol): void;
    insertSemanticItem(item: SemanticItem): void;
    getSemanticItems(framework?: string): SemanticItem[];
    private queryLikePattern;
    queryFTS(query: string, framework?: string, limit?: number): FTSResult[];
    private queryLike;
    getSymbolByPath(path: string): DbSymbol | null;
    getFrameworks(): string[];
    close(): void;
}
