export declare class MemoryCache {
    private readonly cache;
    private readonly cacheTimeout;
    constructor(timeoutMs?: number);
    get<T>(key: string): T | undefined;
    set<T>(key: string, data: T): void;
    clear(): void;
}
