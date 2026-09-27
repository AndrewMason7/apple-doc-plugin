import type { CacheEntry } from '../types/index.js';

export class MemoryCache {
	private readonly cache = new Map<string, CacheEntry<unknown>>();
	private readonly cacheTimeout: number;
	private readonly maxSize: number;

	constructor(timeoutMs: number = 10 * 60 * 1000, maxSize: number = 500) {
		// Default 10 minutes timeout, 500 max entries
		this.cacheTimeout = timeoutMs;
		this.maxSize = maxSize;
	}

	get<T>(key: string): T | undefined {
		const cached = this.cache.get(key);
		if (!cached) {
			return undefined;
		}

		if (Date.now() - cached.timestamp >= this.cacheTimeout) {
			this.cache.delete(key);
			return undefined;
		}

		// Re-insert to refresh LRU order
		this.cache.delete(key);
		this.cache.set(key, cached);
		return cached.data as T;
	}

	set<T>(key: string, data: T): void {
		// If key already exists, delete to update LRU position
		if (this.cache.has(key)) {
			this.cache.delete(key);
		} else if (this.cache.size >= this.maxSize) {
			// Evict oldest entry (first key in map)
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey !== undefined) {
				this.cache.delete(oldestKey);
			}
		}

		this.cache.set(key, {
			data,
			timestamp: Date.now(),
		});
	}

	clear(): void {
		this.cache.clear();
	}
}
