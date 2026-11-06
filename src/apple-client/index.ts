import { HttpClient } from './http-client.js';
import { FileCache } from './cache/file-cache.js';
import { extractText, formatPlatforms } from './formatters.js';
import { logger } from '../server/logger.js';
import type { FrameworkData, SymbolData, Technology } from './types/index.js';

// Re-export types for backward compatibility
export type {
	PlatformInfo,
	FrameworkData,
	SymbolData,
	Technology,
	TopicSection,
	ReferenceData,
} from './types/index.js';

export class AppleDevDocsClient {
	// Expose formatter methods for backward compatibility
	extractText = extractText;
	formatPlatforms = formatPlatforms;

	private readonly httpClient: HttpClient;
	private readonly fileCache: FileCache;

	constructor() {
		this.httpClient = new HttpClient();
		this.fileCache = new FileCache();
	}

	async getFramework(frameworkName: string): Promise<FrameworkData> {
		const cached = await this.fileCache.loadFramework(frameworkName);
		if (cached) {
			return cached;
		}

		const data = await this.httpClient.getDocumentation<FrameworkData>(
			`documentation/${frameworkName}`,
		);
		try {
			await this.fileCache.saveFramework(frameworkName, data);
		} catch (cacheErr) {
			logger.warn(
				`Failed writing framework ${frameworkName} to file cache:`,
				cacheErr,
			);
		}
		return data;
	}

	async getSymbol(path: string): Promise<SymbolData> {
		// Remove leading slash if present
		const cleanPath = path.startsWith('/') ? path.slice(1) : path;

		const cached = await this.fileCache.loadSymbol(cleanPath);
		if (cached) {
			return cached;
		}

		const data = await this.httpClient.getDocumentation<SymbolData>(cleanPath);
		try {
			await this.fileCache.saveSymbol(cleanPath, data);
		} catch (cacheErr) {
			logger.warn(
				`Failed writing symbol ${cleanPath} to file cache:`,
				cacheErr,
			);
		}
		return data;
	}

	async getTechnologies(): Promise<Record<string, Technology>> {
		// Try to load from persistent cache first
		const cached = await this.fileCache.loadTechnologies();
		if (cached && Object.keys(cached).length > 0) {
			return cached;
		}

		// If no cache, download from API and save
		const response = await this.httpClient.getDocumentation<unknown>(
			'documentation/technologies',
		);

		// The API returns a structure with 'references' containing the technologies
		let technologies: Record<string, Technology> = {};

		if (response && typeof response === 'object') {
			if ('references' in response && response.references) {
				technologies = response.references as Record<string, Technology>;
			} else if (typeof response === 'object' && !Array.isArray(response)) {
				// Fallback: treat the whole response as technologies if no references key
				technologies = response as Record<string, Technology>;
			}
		}

		// Save the extracted technologies (not the full response)
		if (Object.keys(technologies).length > 0) {
			try {
				await this.fileCache.saveTechnologies(technologies);
			} catch (cacheErr) {
				logger.warn('Failed writing technologies to file cache:', cacheErr);
			}
		}

		return technologies;
	}
}
