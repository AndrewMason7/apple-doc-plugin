export interface EmbeddingProvider {
	readonly id: 'local-gguf' | 'gemini' | 'unavailable';
	readonly dimensions: number;
	/**
	 * Cosine-similarity floor for a semantic hit. Models do not share a score
	 * distribution: a floor tuned for one silently admits noise on another, so
	 * each provider advertises its own measured threshold.
	 */
	readonly minSimilarity?: number;
	/** Same, but for callers that explicitly prefer semantic matches. */
	readonly minSimilarityPreferred?: number;
	isAvailable(): boolean;
	embedQuery(text: string): Promise<Float32Array | null>;
	embedDocument(content: string, title?: string): Promise<Float32Array | null>;
	/**
	 * Optional batched document embedding. Providers with a batch endpoint
	 * (Gemini exposes batchEmbedContents) implement this so a 19k backfill
	 * costs ~200 requests instead of 19k. A null in the result means that slot
	 * failed and the caller should retry it individually.
	 */
	embedDocuments?(
		items: Array<{ content: string; title?: string }>,
	): Promise<Array<Float32Array | null>>;
}

export function isEmbeddingProvider(obj: unknown): obj is EmbeddingProvider {
	if (!obj || typeof obj !== 'object') return false;
	const p = obj as EmbeddingProvider;
	return (
		(p.id === 'local-gguf' || p.id === 'gemini' || p.id === 'unavailable') &&
		typeof p.dimensions === 'number' &&
		typeof p.isAvailable === 'function' &&
		typeof p.embedQuery === 'function' &&
		typeof p.embedDocument === 'function'
	);
}
