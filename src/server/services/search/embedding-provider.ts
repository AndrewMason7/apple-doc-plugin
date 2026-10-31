export interface EmbeddingProvider {
	readonly id: 'local-gguf' | 'gemini' | 'unavailable';
	readonly dimensions: number;
	isAvailable(): boolean;
	embedQuery(text: string): Promise<Float32Array | null>;
	embedDocument(content: string, title?: string): Promise<Float32Array | null>;
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
