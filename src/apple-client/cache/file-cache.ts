import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FrameworkData, SymbolData, Technology } from '../types/index.js';
import { logger } from '../../server/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class FileCache {
	private readonly docsDir: string;
	private readonly technologiesCachePath: string;

	constructor(baseDir?: string) {
		// Use MCP's own directory structure instead of process.cwd()
		const mcpRoot = join(__dirname, '../../..');
		this.docsDir = join(baseDir ?? mcpRoot, '.cache');
		this.technologiesCachePath = join(this.docsDir, 'technologies.json');
	}

	private async atomicWriteJson(
		filePath: string,
		data: unknown,
	): Promise<void> {
		await this.ensureCacheDir();
		const randomSuffix = Math.random().toString(36).slice(2, 8);
		const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomSuffix}`;
		try {
			await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
			await fs.rename(tmpPath, filePath);
		} catch (err) {
			await fs.unlink(tmpPath).catch(() => {});
			logger.warn(`Failed atomic write to ${filePath}:`, err);
			throw err;
		}
	}

	async loadFramework(
		frameworkName: string,
	): Promise<FrameworkData | undefined> {
		await this.ensureCacheDir();
		const cachePath = this.getCachePath(frameworkName);
		try {
			const raw = await fs.readFile(cachePath, 'utf8');
			return JSON.parse(raw) as FrameworkData;
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
				return undefined;
			}

			if (error instanceof SyntaxError) {
				logger.warn(
					`Corrupted framework cache at ${cachePath}. Purging cache file.`,
				);
				await fs.unlink(cachePath).catch(() => {});
				return undefined;
			}

			logger.warn(
				`Failed reading framework cache for ${frameworkName}:`,
				error,
			);
			return undefined;
		}
	}

	async saveFramework(
		frameworkName: string,
		data: FrameworkData,
	): Promise<void> {
		await this.atomicWriteJson(this.getCachePath(frameworkName), data);
	}

	async loadSymbol(path: string): Promise<SymbolData | undefined> {
		const safePath = path.replaceAll('/', '__');
		const symbolCachePath = join(this.docsDir, `${safePath}.json`);
		try {
			const raw = await fs.readFile(symbolCachePath, 'utf8');
			return JSON.parse(raw) as SymbolData;
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
				return undefined;
			}

			if (error instanceof SyntaxError) {
				logger.warn(
					`Corrupted symbol cache at ${symbolCachePath}. Purging cache file.`,
				);
				await fs.unlink(symbolCachePath).catch(() => {});
				return undefined;
			}

			logger.warn(`Failed reading symbol cache for ${path}:`, error);
			return undefined;
		}
	}

	async saveSymbol(path: string, data: SymbolData): Promise<void> {
		const safePath = path.replaceAll('/', '__');
		await this.atomicWriteJson(join(this.docsDir, `${safePath}.json`), data);
	}

	async loadTechnologies(): Promise<Record<string, Technology> | undefined> {
		await this.ensureCacheDir();
		try {
			const data = await fs.readFile(this.technologiesCachePath, 'utf8');
			const parsed = JSON.parse(data) as unknown;

			// Handle different possible formats of the cached data
			if (parsed && typeof parsed === 'object') {
				// First try: data has a 'references' property (new format from API)
				if ('references' in parsed) {
					const wrapper = parsed as { references?: Record<string, Technology> };
					const refs = wrapper.references ?? {};
					// Validate that we got actual technology data
					if (Object.keys(refs).length > 0) {
						return refs;
					}
				}

				// Second try: data is already the references object (legacy format)
				const direct = parsed as Record<string, Technology>;
				if (Object.keys(direct).length > 0) {
					// Check if it looks like technology data (has identifier/title fields)
					const firstValue = Object.values(direct)[0];
					if (
						firstValue &&
						typeof firstValue === 'object' &&
						('identifier' in firstValue || 'title' in firstValue)
					) {
						return direct;
					}
				}
			}

			// If we got here, the cache might be corrupted or empty
			logger.warn(
				'Technologies cache exists but appears invalid, will refetch',
			);
			return undefined;
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
				return undefined;
			}

			if (error instanceof SyntaxError) {
				logger.warn(
					`Corrupted technologies cache at ${this.technologiesCachePath}. Purging cache file.`,
				);
				await fs.unlink(this.technologiesCachePath).catch(() => {});
				return undefined;
			}

			logger.warn('Error loading technologies cache:', error);
			return undefined;
		}
	}

	async saveTechnologies(
		technologies: Record<string, Technology>,
	): Promise<void> {
		await this.atomicWriteJson(this.technologiesCachePath, technologies);
	}

	private sanitizeFrameworkName(name: string): string {
		return name.replaceAll(/[^\w-]/gi, '_');
	}

	private async ensureCacheDir(): Promise<void> {
		await fs.mkdir(this.docsDir, { recursive: true });
	}

	private getCachePath(frameworkName: string): string {
		const safeName = this.sanitizeFrameworkName(frameworkName);
		return join(this.docsDir, `${safeName}.json`);
	}
}
