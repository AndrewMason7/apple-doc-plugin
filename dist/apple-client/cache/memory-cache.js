export class MemoryCache {
    cache = new Map();
    cacheTimeout;
    constructor(timeoutMs = 10 * 60 * 1000) {
        // Default 10 minutes
        this.cacheTimeout = timeoutMs;
    }
    get(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return undefined;
    }
    set(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
        });
    }
    clear() {
        this.cache.clear();
    }
}
//# sourceMappingURL=memory-cache.js.map