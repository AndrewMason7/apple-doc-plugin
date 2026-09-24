import { HttpClient } from './apple-client/http-client.js';
import { FileCache } from './apple-client/cache/file-cache.js';
import { extractText, formatPlatforms } from './apple-client/formatters.js';
export class AppleDevDocsClient {
    // Expose formatter methods for backward compatibility
    extractText = extractText;
    formatPlatforms = formatPlatforms;
    httpClient;
    fileCache;
    constructor() {
        this.httpClient = new HttpClient();
        this.fileCache = new FileCache();
    }
    async getFramework(frameworkName) {
        const cached = await this.fileCache.loadFramework(frameworkName);
        if (cached) {
            return cached;
        }
        const data = await this.httpClient.getDocumentation(`documentation/${frameworkName}`);
        await this.fileCache.saveFramework(frameworkName, data);
        return data;
    }
    async getSymbol(path) {
        // Remove leading slash if present
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const cached = await this.fileCache.loadSymbol(cleanPath);
        if (cached) {
            return cached;
        }
        const data = await this.httpClient.getDocumentation(cleanPath);
        await this.fileCache.saveSymbol(cleanPath, data);
        return data;
    }
    async getTechnologies() {
        // Try to load from persistent cache first
        const cached = await this.fileCache.loadTechnologies();
        if (cached && Object.keys(cached).length > 0) {
            return cached;
        }
        // If no cache, download from API and save
        const response = await this.httpClient.getDocumentation('documentation/technologies');
        // The API returns a structure with 'references' containing the technologies
        let technologies = {};
        if (response && typeof response === 'object') {
            if ('references' in response && response.references) {
                technologies = response.references;
            }
            else if (typeof response === 'object' && !Array.isArray(response)) {
                // Fallback: treat the whole response as technologies if no references key
                technologies = response;
            }
        }
        // Save the extracted technologies (not the full response)
        if (Object.keys(technologies).length > 0) {
            await this.fileCache.saveTechnologies(technologies);
        }
        return technologies;
    }
}
//# sourceMappingURL=apple-client.js.map