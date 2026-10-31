import { existsSync } from 'node:fs';
import type { EmbeddingProvider } from './embedding-provider.js';
import {
	LocalGemmaEmbeddingProvider,
	getDefaultLocalModelPath,
} from './local-gemma-provider.js';
import { GeminiSemanticSearch } from './semantic-search.js';

export interface ProviderOptions {
	preferredProvider?: 'local' | 'gemini';
	localModelPath?: string;
	geminiApiKey?: string | null;
	disableAdc?: boolean;
}

export class UnavailableEmbeddingProvider implements EmbeddingProvider {
	public readonly id = 'unavailable' as const;
	public readonly dimensions = 0;

	isAvailable(): boolean {
		return false;
	}

	async embedQuery(): Promise<Float32Array | null> {
		return null;
	}

	async embedDocument(): Promise<Float32Array | null> {
		return null;
	}
}

export function resolveEmbeddingProvider(
	options: ProviderOptions = {},
): EmbeddingProvider {
	const envProvider =
		process.env.APPLE_DOCS_EMBEDDING_PROVIDER?.toLowerCase().trim();
	const preferred =
		options.preferredProvider ||
		(envProvider === 'gemini' || envProvider === 'local' ? envProvider : null);

	const localPath = options.localModelPath || getDefaultLocalModelPath();

	// 1. If Gemini is explicitly preferred, try Gemini first
	if (preferred === 'gemini') {
		const gemini = new GeminiSemanticSearch(options.geminiApiKey);
		if (gemini.isAvailable()) {
			return gemini;
		}
	}

	// 2. Default: check if local GGUF model is available
	if (preferred !== 'gemini' && localPath && existsSync(localPath)) {
		const localProvider = new LocalGemmaEmbeddingProvider(localPath);
		if (localProvider.isAvailable()) {
			return localProvider;
		}
	}

	// 3. Fallback to Gemini if auth is configured
	const gemini = new GeminiSemanticSearch(
		options.geminiApiKey === null ? null : options.geminiApiKey,
	);
	if (gemini.isAvailable() && !options.disableAdc) {
		return gemini;
	}

	// 4. Fallback when neither is available
	return new UnavailableEmbeddingProvider();
}
