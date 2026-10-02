import axios from 'axios';
import { MemoryCache } from './cache/memory-cache.js';
import { AppleDocsNetworkError } from '../server/errors.js';
import { logger } from '../server/logger.js';

const baseUrl = 'https://developer.apple.com/tutorials/data';

const headers = {
	dnt: '1',
	referer: 'https://developer.apple.com/documentation',
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
};

export interface RetryOptions {
	maxRetries?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
}

export class HttpClient {
	private readonly cache: MemoryCache;

	constructor() {
		this.cache = new MemoryCache();
	}

	async makeRequest<T>(path: string, options: RetryOptions = {}): Promise<T> {
		const url = `${baseUrl}/${path}`;

		// Simple cache check
		const cached = this.cache.get<T>(url);
		if (cached) {
			return cached;
		}

		const maxRetries = options.maxRetries ?? 2;
		let attempt = 0;
		let delay = options.initialDelayMs ?? 250;

		while (true) {
			try {
				const response = await axios.get<T>(url, {
					headers,
					timeout: 15_000,
				});

				// Cache the result
				this.cache.set(url, response.data);
				return response.data;
			} catch (error: unknown) {
				attempt++;
				const isAxios = axios.isAxiosError(error);
				const status = isAxios ? error.response?.status : undefined;
				const code = isAxios ? error.code : undefined;
				const message = error instanceof Error ? error.message : String(error);

				// 404 is Not Found - never retry, fast-fail immediately
				if (status === 404) {
					logger.debug(`Documentation not found at ${url} (404)`);
					throw new AppleDocsNetworkError(
						`Documentation not found at ${path}`,
						404,
						false,
						error,
					);
				}

				const isTransient =
					status === 429 ||
					(status !== undefined && status >= 500) ||
					code === 'ECONNRESET' ||
					code === 'ETIMEDOUT' ||
					code === 'ECONNABORTED';

				if (attempt > maxRetries || !isTransient) {
					logger.warn(
						`Failed to fetch ${url} (attempt ${attempt}/${maxRetries + 1}): ${message}`,
					);
					throw new AppleDocsNetworkError(
						`Failed to fetch documentation: ${message}`,
						status,
						isTransient,
						error,
					);
				}

				const jitter = Math.random() * 100;
				logger.warn(
					`Transient error fetching ${url} (${status || code}). Retrying in ${Math.round(delay + jitter)}ms (attempt ${attempt}/${maxRetries + 1})...`,
				);
				await new Promise((resolve) => setTimeout(resolve, delay + jitter));
				delay = Math.min(delay * 2, options.maxDelayMs ?? 2000);
			}
		}
	}

	async getDocumentation<T>(path: string, options?: RetryOptions): Promise<T> {
		return this.makeRequest<T>(`${path}.json`, options);
	}

	clearCache(): void {
		this.cache.clear();
	}
}
