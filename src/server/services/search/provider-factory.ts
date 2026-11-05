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
	/** Requested output dimensions (MRL truncation) for the hosted provider. */
	dimensions?: number;
}

/**
 * MRL truncation steps the Gemini embedding family supports. Truncating keeps
 * vector direction (the model re-normalises for us) while cutting storage and
 * scan cost; 768 scores within ~0.2 MTEB points of 1536 on their own numbers.
 */
export const SUPPORTED_EMBEDDING_DIMENSIONS = [
	128, 256, 512, 768, 1024, 1536, 2048, 3072,
] as const;

/**
 * Parse a requested dimension count. Anything unsupported returns undefined so
 * the provider default (768) applies instead of silently writing vectors that a
 * query vector cannot be compared against.
 */
export function resolveRequestedDimensions(
	raw: string | undefined = process.env.APPLE_DOCS_EMBEDDING_DIMENSIONS,
): number | undefined {
	if (!raw || !raw.trim()) return undefined;
	const parsed = Number(raw.trim());
	if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
	return (SUPPORTED_EMBEDDING_DIMENSIONS as readonly number[]).includes(parsed)
		? parsed
		: undefined;
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

	const requestedDimensions =
		options.dimensions ?? resolveRequestedDimensions();

	// 1. If Gemini is explicitly preferred, try Gemini first
	if (preferred === 'gemini') {
		const gemini = new GeminiSemanticSearch(
			options.geminiApiKey,
			undefined,
			undefined,
			undefined,
			requestedDimensions,
		);
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
		undefined,
		undefined,
		undefined,
		requestedDimensions,
	);
	if (gemini.isAvailable() && !options.disableAdc) {
		return gemini;
	}

	// 4. Fallback when neither is available
	return new UnavailableEmbeddingProvider();
}
