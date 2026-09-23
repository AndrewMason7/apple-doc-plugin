import { type AppleDevDocsClient } from '../../apple-client.js';
export type LocalSymbolIndexEntry = {
    id: string;
    title: string;
    path: string;
    kind: string;
    abstract: string;
    platforms: string[];
    tokens: string[];
    filePath: string;
};
export declare class LocalSymbolIndex {
    private readonly client;
    private readonly symbols;
    private readonly cacheDir;
    private readonly technologyIdentifier?;
    private indexBuilt;
    constructor(client: AppleDevDocsClient, technologyIdentifier?: string);
    buildIndexFromCache(): Promise<void>;
    search(query: string, maxResults?: number): LocalSymbolIndexEntry[];
    getSymbolCount(): number;
    clear(): void;
    private isValidCacheData;
    private tokenize;
    private processSymbolData;
    private createTokens;
    private processReferences;
}
