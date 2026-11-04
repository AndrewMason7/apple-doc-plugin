import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { EmbeddingProvider } from './embedding-provider.js';

export function getDefaultLocalModelPath(): string {
	if (process.env.APPLE_DOCS_EMBEDDING_MODEL_PATH) {
		return process.env.APPLE_DOCS_EMBEDDING_MODEL_PATH;
	}
	const home = homedir();
	const candidates = [
		join(home, 'Documents/GitHub/Models/embeddinggemma-2-Q8_0.gguf'),
		join(home, '.cache/apple-docs/models/embeddinggemma-2-Q8_0.gguf'),
	];
	for (const p of candidates) {
		if (existsSync(p)) return p;
	}
	return candidates[0];
}

function l2Normalize(values: ArrayLike<number>): Float32Array {
	const out = Float32Array.from(values);
	let sum = 0;
	for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
	const norm = Math.sqrt(sum);
	if (norm > 0) {
		for (let i = 0; i < out.length; i++) out[i] /= norm;
	}
	return out;
}

export class LocalGemmaEmbeddingProvider implements EmbeddingProvider {
	public readonly id = 'local-gguf' as const;
	public readonly dimensions = 768;
	/**
	 * Measured with embeddinggemma-2 Q8_0 on Apple symbol text: on-topic pairs
	 * score 0.688-0.719, unrelated pairs top out near 0.66. 0.68 keeps the
	 * relevant band and drops the noise that Gemini's 0.65 floor let through.
	 */
	public readonly minSimilarity = 0.68;
	public readonly minSimilarityPreferred = 0.62;
	public readonly modelPath: string;

	private llamaInstance: any = null;
	private modelInstance: any = null;
	private embeddingContext: any = null;
	private initPromise: Promise<void> | null = null;
	private failedInit = false;

	constructor(modelPath?: string) {
		this.modelPath = modelPath || getDefaultLocalModelPath();
	}

	isAvailable(): boolean {
		if (this.failedInit) return false;
		return Boolean(
			this.modelPath &&
			this.modelPath.trim().length > 0 &&
			existsSync(this.modelPath),
		);
	}

	static prepareQuery(query: string, task = 'search result'): string {
		const trimmed = query.trim();
		if (!trimmed) return '';
		if (trimmed.startsWith('task:')) return trimmed;
		return `task: ${task} | query: ${trimmed}`;
	}

	static prepareDocument(content: string, title?: string): string {
		const trimmed = content.trim();
		const cleanTitle = title && title.trim().length > 0 ? title.trim() : 'none';
		if (trimmed.startsWith('title:')) return trimmed;
		return `title: ${cleanTitle} | text: ${trimmed}`;
	}

	private async ensureInitialized(): Promise<boolean> {
		if (this.embeddingContext) return true;
		if (this.failedInit || !this.isAvailable()) return false;

		if (!this.initPromise) {
			this.initPromise = (async () => {
				try {
					const { getLlama } = await import('node-llama-cpp');
					this.llamaInstance = await getLlama();
					this.modelInstance = await this.llamaInstance.loadModel({
						modelPath: this.modelPath,
					});
					this.embeddingContext =
						await this.modelInstance.createEmbeddingContext();
				} catch (err) {
					console.error(
						'Warning: Failed to initialize in-process LocalGemmaEmbeddingProvider:',
						err instanceof Error ? err.message : err,
					);
					this.failedInit = true;
				}
			})();
		}

		await this.initPromise;
		return Boolean(this.embeddingContext);
	}

	async embedQuery(text: string): Promise<Float32Array | null> {
		if (!text || text.trim().length === 0) return null;
		const ready = await this.ensureInitialized();
		if (!ready || !this.embeddingContext) return null;

		try {
			const formatted = LocalGemmaEmbeddingProvider.prepareQuery(text);
			const embeddingResult =
				await this.embeddingContext.getEmbeddingFor(formatted);
			const vector = embeddingResult?.vector;
			if (!vector || vector.length === 0) return null;
			return l2Normalize(vector);
		} catch (err) {
			console.error(
				'Warning: LocalGemmaEmbeddingProvider embedQuery failed:',
				err instanceof Error ? err.message : err,
			);
			return null;
		}
	}

	async embedDocument(
		content: string,
		title?: string,
	): Promise<Float32Array | null> {
		if (!content || content.trim().length === 0) return null;
		const ready = await this.ensureInitialized();
		if (!ready || !this.embeddingContext) return null;

		try {
			const formatted = LocalGemmaEmbeddingProvider.prepareDocument(
				content,
				title,
			);
			const embeddingResult =
				await this.embeddingContext.getEmbeddingFor(formatted);
			const vector = embeddingResult?.vector;
			if (!vector || vector.length === 0) return null;
			return l2Normalize(vector);
		} catch (err) {
			console.error(
				'Warning: LocalGemmaEmbeddingProvider embedDocument failed:',
				err instanceof Error ? err.message : err,
			);
			return null;
		}
	}
}