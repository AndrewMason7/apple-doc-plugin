import axios from 'axios';
import { MemoryCache } from './cache/memory-cache.js';
const baseUrl = 'https://developer.apple.com/tutorials/data';
const headers = {
    dnt: '1',
    referer: 'https://developer.apple.com/documentation',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
};
export class HttpClient {
    cache;
    constructor() {
        this.cache = new MemoryCache();
    }
    async makeRequest(path) {
        const url = `${baseUrl}/${path}`;
        // Simple cache check
        const cached = this.cache.get(url);
        if (cached) {
            return cached;
        }
        try {
            const response = await axios.get(url, {
                headers,
                timeout: 15_000, // 15 second timeout
            });
            // Cache the result
            this.cache.set(url, response.data);
            return response.data;
        }
        catch (error) {
            console.error(`Error fetching ${url}:`, error instanceof Error ? error.message : String(error));
            throw new Error(`Failed to fetch documentation: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async getDocumentation(path) {
        return this.makeRequest(`${path}.json`);
    }
    clearCache() {
        this.cache.clear();
    }
}
//# sourceMappingURL=http-client.js.map