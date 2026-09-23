import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export class LocalSymbolIndex {
    client;
    symbols = new Map();
    cacheDir;
    technologyIdentifier;
    indexBuilt = false;
    constructor(client, technologyIdentifier) {
        this.client = client;
        this.cacheDir = join(__dirname, '../../../.cache');
        this.technologyIdentifier = technologyIdentifier;
    }
    async buildIndexFromCache() {
        if (this.indexBuilt) {
            console.error('📚 Index already built, skipping rebuild');
            return;
        }
        console.error('📚 Building local symbol index from cached files...');
        // Validate cache directory exists
        if (!existsSync(this.cacheDir)) {
            console.warn(`Cache directory does not exist: ${this.cacheDir}`);
            this.indexBuilt = true;
            return;
        }
        // Read all JSON files in the docs directory
        const files = readdirSync(this.cacheDir).filter((file) => file.endsWith('.json'));
        console.error(`📁 Found ${files.length} cached files`);
        let processedCount = 0;
        let errorCount = 0;
        for (const file of files) {
            const filePath = join(this.cacheDir, file);
            try {
                const rawData = readFileSync(filePath, 'utf8');
                const data = JSON.parse(rawData);
                // Validate data structure
                if (!this.isValidCacheData(data)) {
                    console.warn(`Invalid cache data in ${file}, skipping`);
                    errorCount++;
                    continue;
                }
                // Process the data
                this.processSymbolData(data, filePath);
                processedCount++;
            }
            catch (error) {
                console.warn(`Failed to process ${file}:`, error instanceof Error ? error.message : String(error));
                errorCount++;
            }
        }
        this.indexBuilt = true;
        console.error(`✅ Local symbol index built with ${this.symbols.size} symbols (${processedCount} files processed, ${errorCount} errors)`);
    }
    search(query, maxResults = 20) {
        const results = [];
        const queryTokens = this.tokenize(query);
        // Check if query contains wildcards
        const hasWildcards = query.includes('*') || query.includes('?');
        for (const entry of this.symbols.values()) {
            let score = 0;
            if (hasWildcards) {
                // Wildcard matching
                const pattern = query
                    .replaceAll('*', '.*')
                    .replaceAll('?', '.')
                    .toLowerCase();
                const regex = new RegExp(`^${pattern}$`);
                if (regex.test(entry.title.toLowerCase()) ||
                    regex.test(entry.path.toLowerCase()) ||
                    entry.tokens.some((token) => regex.test(token))) {
                    score = 100; // High score for wildcard matches
                }
            }
            else {
                // Regular token-based matching
                for (const queryToken of queryTokens) {
                    if (entry.title.toLowerCase().includes(queryToken.toLowerCase())) {
                        score += 50;
                    }
                    if (entry.tokens.includes(queryToken)) {
                        score += 30;
                    }
                    if (entry.abstract.toLowerCase().includes(queryToken.toLowerCase())) {
                        score += 10;
                    }
                }
            }
            if (score > 0) {
                results.push({ entry, score });
            }
        }
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults)
            .map((result) => result.entry);
    }
    getSymbolCount() {
        return this.symbols.size;
    }
    clear() {
        this.symbols.clear();
        this.indexBuilt = false;
    }
    isValidCacheData(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }
        const object = data;
        // Check for required properties
        if (!('abstract' in object) || !('metadata' in object)) {
            return false;
        }
        // Validate metadata structure
        const { metadata } = object;
        if (!metadata || typeof metadata !== 'object') {
            return false;
        }
        return true;
    }
    tokenize(text) {
        if (!text) {
            return [];
        }
        const tokens = new Set();
        // Split on common delimiters
        const basicTokens = text.split(/[\s/._-]+/).filter(Boolean);
        for (const token of basicTokens) {
            // Add lowercase version
            tokens.add(token.toLowerCase());
            // Add original case version for exact matches
            tokens.add(token);
            // Handle camelCase/PascalCase (e.g., GridItem -> grid, item, griditem)
            const camelParts = token.split(/(?=[A-Z])/).filter(Boolean);
            if (camelParts.length > 1) {
                for (const part of camelParts) {
                    tokens.add(part.toLowerCase());
                    tokens.add(part);
                }
                // Add concatenated lowercase version
                tokens.add(camelParts.join('').toLowerCase());
            }
        }
        return [...tokens];
    }
    processSymbolData(data, filePath) {
        const title = data.metadata?.title || 'Unknown';
        const path = data.metadata &&
            'url' in data.metadata &&
            typeof data.metadata.url === 'string'
            ? data.metadata.url
            : '';
        const kind = data.metadata &&
            'symbolKind' in data.metadata &&
            typeof data.metadata.symbolKind === 'string'
            ? data.metadata.symbolKind
            : 'framework';
        const abstract = this.client.extractText(data.abstract);
        const platforms = data.metadata?.platforms?.map((p) => p.name).filter(Boolean) || [];
        // Filter by technology if specified
        if (this.technologyIdentifier && path) {
            const technologyPath = this.technologyIdentifier.toLowerCase();
            const symbolPath = path.toLowerCase();
            if (!symbolPath.includes(technologyPath)) {
                return; // Skip symbols not from the selected technology
            }
        }
        // Create comprehensive tokens
        const tokens = this.createTokens(title, abstract, path, platforms);
        const entry = {
            id: path || title,
            title,
            path,
            kind,
            abstract,
            platforms,
            tokens,
            filePath,
        };
        this.symbols.set(path || title, entry);
        // Process references recursively
        this.processReferences(data.references, filePath);
    }
    createTokens(title, abstract, path, platforms) {
        const tokens = new Set();
        for (const token of this.tokenize(title)) {
            tokens.add(token);
        }
        for (const token of this.tokenize(abstract)) {
            tokens.add(token);
        }
        for (const token of this.tokenize(path)) {
            tokens.add(token);
        }
        // Add platform tokens
        for (const platform of platforms) {
            for (const token of this.tokenize(platform)) {
                tokens.add(token);
            }
        }
        return [...tokens];
    }
    processReferences(references, filePath) {
        if (!references) {
            return;
        }
        for (const [refId, ref] of Object.entries(references)) {
            if (ref.kind === 'symbol' && ref.title) {
                // Filter references by technology if specified
                if (this.technologyIdentifier && ref.url) {
                    const technologyPath = this.technologyIdentifier.toLowerCase();
                    const refPath = ref.url.toLowerCase();
                    if (!refPath.includes(technologyPath)) {
                        continue; // Skip references not from the selected technology
                    }
                }
                const refTokens = this.createTokens(ref.title, this.client.extractText(ref.abstract ?? []), ref.url || '', ref.platforms?.map((p) => p.name).filter(Boolean) ?? []);
                const refEntry = {
                    id: refId,
                    title: ref.title,
                    path: ref.url || '',
                    kind: ref.kind,
                    abstract: this.client.extractText(ref.abstract ?? []),
                    platforms: ref.platforms?.map((p) => p.name).filter(Boolean) ?? [],
                    tokens: refTokens,
                    filePath,
                };
                this.symbols.set(refId, refEntry);
            }
        }
    }
}
//# sourceMappingURL=local-symbol-index.js.map