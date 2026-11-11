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
	public readonly modelId = 'none' as const;
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
	// Hermes bridge credential isolation: the bridge child env sets
	// APPLE_DOCS_DISABLE_ADC=1 so ambient Google Application Default
	// Credentials (GOOGLE_APPLICATION_CREDENTIALS, the gcloud credential
	// file, or the cloud metadata server) never authenticate this plugin —
	// only a GEMINI_API_KEY explicitly injected by the bridge from
	// agent.secret_scope is accepted. The env flag cannot be weakened by an
	// explicit `disableAdc: false`; GeminiSemanticSearch enforces the same
	// flag at the credential site (hasAdc/getAuthHeaders), so this gate is
	// defense in depth rather than the only line.
	const disableAdc =
		options.disableAdc === true || process.env.APPLE_DOCS_DISABLE_ADC === '1';
	const envProvider =
		process.env.APPLE_DOCS_EMBEDDING_PROVIDER?.toLowerCase().trim();
	const preferred =
		options.preferredProvider ||
		(envProvider === 'gemini' || envProvider === 'local' ? envProvider : null);

	const localPath = options.localModelPath || getDefaultLocalModelPath();

	const requestedDimensions =
		options.dimensions ?? resolveRequestedDimensions();

	// 1. If local GGUF is explicitly preferred via option or APPLE_DOCS_EMBEDDING_PROVIDER=local
	if (preferred === 'local' && localPath && existsSync(localPath)) {
		const localProvider = new LocalGemmaEmbeddingProvider(localPath);
		if (localProvider.isAvailable()) {
			return localProvider;
		}
	}

	// 2. Default priority: Gemini key auth (env-injected by the Hermes bridge
	// via agent.secret_scope) or — only when ADC is not disabled — ambient ADC.
	// Gemini provides significantly higher semantic recall on nuanced behavioral queries.
	if (preferred !== 'local') {
		const gemini = new GeminiSemanticSearch(
			options.geminiApiKey === null ? null : options.geminiApiKey,
			undefined,
			undefined,
			undefined,
			requestedDimensions,
		);
		if (gemini.isAvailable() && (gemini.hasApiKey() || !disableAdc)) {
			return gemini;
		}
	}

	// 3. Fallback to local GGUF model if present (offline or air-gapped mode)
	if (localPath && existsSync(localPath)) {
		const localProvider = new LocalGemmaEmbeddingProvider(localPath);
		if (localProvider.isAvailable()) {
			return localProvider;
		}
	}

	// 4. Fallback when neither is available
	return new UnavailableEmbeddingProvider();
}
