import axios from 'axios';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GoogleAuth } from 'google-auth-library';
import type { EmbeddingProvider } from './embedding-provider.js';
import { withRetry } from './retry.js';

export interface SemanticMatch {
	id: string;
	framework: string;
	title: string;
	kind: string;
	summary: string;
	path: string;
	mediaUrl?: string;
	mediaType?: string;
	similarity: number;
}

export interface GoogleAuthClient {
	getClient(): Promise<{
		getAccessToken(): Promise<{ token?: string | null } | string | null>;
	}>;
}

const MULTIMODAL_MIME_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/jpg',
	'video/mp4',
	'video/quicktime',
	'audio/mpeg',
	'audio/wav',
	'audio/x-wav',
	'application/pdf',
]);

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

function stripMultimodalTaskPrefix(text: string): string {
	return text.replace(/^task:\s*[^|]*\|\s*query:\s*/i, '').trim();
}

export class GeminiSemanticSearch implements EmbeddingProvider {
	public readonly id = 'gemini' as const;
	/** Gemini's score distribution differs from a local model's; keep its floor. */
	public readonly minSimilarity = 0.65;
	public readonly minSimilarityPreferred = 0.55;
	private readonly apiKey?: string;
	private readonly modelName: string;
	private readonly baseUrl: string;
	private readonly googleAuth: GoogleAuthClient;
	private readonly hasInjectedAuth: boolean;
	private readonly authDisabled: boolean;
	private circuitOpenUntil = 0;
	private cachedAccessToken: { token: string; expiresAt: number } | null = null;
	public readonly expectedDimensions?: number;

	constructor(
		apiKey?: string | null,
		modelName = 'models/gemini-embedding-2',
		baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
		googleAuth?: GoogleAuthClient,
		expectedDimensions?: number,
	) {
		this.expectedDimensions = expectedDimensions;
		if (apiKey === null && !googleAuth) {
			this.apiKey = undefined;
			this.authDisabled = true;
		} else {
			this.apiKey =
				apiKey === null ? undefined : apiKey || process.env.GEMINI_API_KEY;
			this.authDisabled = false;
		}
		this.modelName = modelName;
		this.baseUrl = baseUrl.replace(/\/+$/, '');

		if (googleAuth) {
			this.googleAuth = googleAuth;
			this.hasInjectedAuth = true;
		} else {
			this.googleAuth = new GoogleAuth({
				scopes: [
					'https://www.googleapis.com/auth/generative-language',
					'https://www.googleapis.com/auth/cloud-platform',
				],
			});
			this.hasInjectedAuth = false;
		}
	}

	get dimensions(): number {
		return this.expectedDimensions ?? 3072;
	}

	isAvailable(): boolean {
		return this.hasAuth();
	}

	hasApiKey(): boolean {
		if (this.authDisabled) return false;
		return Boolean(this.apiKey && this.apiKey.trim().length > 0);
	}

	hasAdc(): boolean {
		if (this.authDisabled) return false;
		if (this.hasInjectedAuth) return true;

		if (
			process.env.GOOGLE_APPLICATION_CREDENTIALS &&
			process.env.GOOGLE_APPLICATION_CREDENTIALS.trim().length > 0
		) {
			if (existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS.trim())) {
				return true;
			}
		}
		const home = process.env.HOME || process.env.USERPROFILE || '';
		if (home) {
			const defaultGcloudPath = join(
				home,
				'.config/gcloud/application_default_credentials.json',
			);
			if (existsSync(defaultGcloudPath)) {
				return true;
			}
		}
		if (
			process.env.K_SERVICE ||
			process.env.GAE_SERVICE ||
			process.env.CLOUD_RUN_JOB
		) {
			return true;
		}
		return false;
	}

	hasAuth(): boolean {
		return this.hasApiKey() || this.hasAdc();
	}

	async getAuthHeaders(): Promise<Record<string, string> | null> {
		if (this.authDisabled) return null;

		// 1. Explicit API key takes highest precedence
		if (this.hasApiKey()) {
			return { 'x-goog-api-key': this.apiKey! };
		}

		// 2. Application Default Credentials (ADC)
		try {
			const now = Date.now();
			if (
				this.cachedAccessToken &&
				this.cachedAccessToken.expiresAt > now + 60_000
			) {
				return { Authorization: `Bearer ${this.cachedAccessToken.token}` };
			}

			const client = await this.googleAuth.getClient();
			const tokenResult = await client.getAccessToken();
			const token =
				typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;
			if (token && typeof token === 'string' && token.trim().length > 0) {
				const clientCredentials = (
					client as { credentials?: { expiry_date?: number } }
				)?.credentials;
				const expiryDateMs = clientCredentials?.expiry_date;
				const resData = (
					tokenResult as { res?: { data?: { expires_in?: number } } }
				)?.res?.data;
				const expiresInSec = resData?.expires_in;
				const ttlMs =
					expiryDateMs && expiryDateMs > now
						? expiryDateMs - now
						: expiresInSec
							? expiresInSec * 1000
							: 50 * 60 * 1000;

				this.cachedAccessToken = {
					token,
					expiresAt: now + ttlMs,
				};
				return { Authorization: `Bearer ${token}` };
			}
		} catch {
			// ADC unavailable or error fetching credentials
		}

		return null;
	}

	/** Sleep until the breaker closes, so a bulk run waits rather than failing fast. */
	private async waitForCircuitClosed(maxWaitMs = 40_000): Promise<void> {
		const started = Date.now();
		while (this.isCircuitOpen()) {
			if (Date.now() - started > maxWaitMs) return;
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
	}

	/** 429, 5xx, timeouts and network errors are worth retrying; 4xx are not. */
	private isRetryableError(error: unknown): boolean {
		if (!axios.isAxiosError(error)) return true;
		const status = error.response?.status;
		if (!status) return true; // timeout / ECONNRESET / DNS
		return status === 429 || status >= 500;
	}

	isCircuitOpen(): boolean {
		return Date.now() < this.circuitOpenUntil;
	}

	tripCircuitBreaker(durationMs = 30_000): void {
		this.circuitOpenUntil = Date.now() + durationMs;
	}

	resetCircuitBreaker(): void {
		this.circuitOpenUntil = 0;
	}

	private handleApiError(err: unknown, action: string): void {
		if (axios.isAxiosError(err)) {
			const status = err.response?.status;
			const isTimeout =
				err.code === 'ECONNABORTED' ||
				err.message.toLowerCase().includes('timeout');
			const isNetworkError =
				err.code === 'ECONNRESET' ||
				err.code === 'ENOTFOUND' ||
				err.code === 'ECONNREFUSED';
			const isAuthError = status === 401 || status === 403;
			const isRateLimitOrServer =
				status === 429 || (status !== undefined && status >= 500);

			if (isTimeout || isNetworkError || isAuthError || isRateLimitOrServer) {
				this.tripCircuitBreaker(30_000);
				console.error(
					`Warning: Gemini API error (${status || err.code || 'timeout'}) during ${action}. Circuit breaker tripped for 30s.`,
				);
				return;
			}
		}
		console.error(
			`Warning: Gemini API call failed during ${action}:`,
			err instanceof Error ? err.message : err,
		);
	}

	/**
	 * Formats query string according to official Gemini Embedding 2 asymmetric retrieval prompt guidelines:
	 * `task: search result | query: {query}`
	 */
	static prepareQuery(query: string, task = 'search result'): string {
		const trimmed = query.trim();
		if (!trimmed) return '';
		if (trimmed.startsWith('task:')) return trimmed;
		return `task: ${task} | query: ${trimmed}`;
	}

	/**
	 * Formats document string according to official Gemini Embedding 2 asymmetric retrieval guidelines:
	 * `title: {title} | text: {content}` (or `title: none | text: {content}`)
	 */
	static prepareDocument(content: string, title?: string): string {
		const trimmed = content.trim();
		const cleanTitle = title && title.trim().length > 0 ? title.trim() : 'none';
		if (trimmed.startsWith('title:')) return trimmed;
		return `title: ${cleanTitle} | text: ${trimmed}`;
	}

	/**
	 * Gemini Embedding 2 takes task instructions in the prompt and rejects task_type.
	 * Every other model, including gemini-embedding-001, uses the task_type field.
	 */
	isEmbedding2(): boolean {
		return this.modelName.includes('gemini-embedding-2');
	}

	private requestedDimensions(): number {
		return this.expectedDimensions ?? 3072;
	}

	private embeddingFromValues(
		values: unknown,
		requestedDims: number,
	): Float32Array | null {
		if (!Array.isArray(values) || values.length !== requestedDims) {
			const got = Array.isArray(values) ? String(values.length) : 'none';
			console.warn(
				`Warning: Gemini API returned ${got} dimensions, expected ${requestedDims}`,
			);
			return null;
		}
		// gemini-embedding-2 renormalizes truncated vectors. gemini-embedding-001 does not.
		if (!this.isEmbedding2() && requestedDims !== 3072) {
			return l2Normalize(values as number[]);
		}
		return Float32Array.from(values as number[]);
	}

	async embedQuery(text: string): Promise<Float32Array | null> {
		if (!text || text.trim().length === 0) return null;
		if (this.isCircuitOpen()) return null;
		const authHeaders = await this.getAuthHeaders();
		if (!authHeaders) return null;

		try {
			const url = `${this.baseUrl}/${this.modelName}:embedContent`;
			const outputDims = this.requestedDimensions();
			const formattedText = this.isEmbedding2()
				? GeminiSemanticSearch.prepareQuery(text)
				: text.trim();

			const payload: Record<string, unknown> = {
				content: { parts: [{ text: formattedText }] },
				output_dimensionality: outputDims,
			};

			if (!this.isEmbedding2()) {
				payload.task_type = 'RETRIEVAL_QUERY';
			}

			const response = await axios.post<{
				embedding?: { values?: number[] };
			}>(url, payload, {
				headers: {
					'Content-Type': 'application/json',
					...authHeaders,
				},
				timeout: 4000,
			});
			return this.embeddingFromValues(
				response.data?.embedding?.values,
				outputDims,
			);
		} catch (err) {
			this.handleApiError(err, 'embedQuery');
			return null;
		}
	}

	async embedDocument(
		content: string,
		title?: string,
	): Promise<Float32Array | null> {
		if (!content || content.trim().length === 0) return null;
		if (this.isCircuitOpen()) return null;
		const authHeaders = await this.getAuthHeaders();
		if (!authHeaders) return null;

		try {
			const url = `${this.baseUrl}/${this.modelName}:embedContent`;
			const outputDims = this.requestedDimensions();
			const formattedText = this.isEmbedding2()
				? GeminiSemanticSearch.prepareDocument(content, title)
				: content.trim();

			const payload: Record<string, unknown> = {
				content: { parts: [{ text: formattedText }] },
				output_dimensionality: outputDims,
			};

			if (!this.isEmbedding2()) {
				payload.task_type = 'RETRIEVAL_DOCUMENT';
				if (title && title.trim().length > 0) {
					payload.title = title.trim();
				}
			}

			const response = await axios.post<{
				embedding?: { values?: number[] };
			}>(url, payload, {
				headers: {
					'Content-Type': 'application/json',
					...authHeaders,
				},
				timeout: 4000,
			});
			return this.embeddingFromValues(
				response.data?.embedding?.values,
				outputDims,
			);
		} catch (err) {
			this.handleApiError(err, 'embedDocument');
			return null;
		}
	}

	/**
	 * Batched document embedding via :batchEmbedContents (max 100 per request).
	 * Failures are returned as nulls rather than thrown, so the caller can retry
	 * individual items; a chunk-level failure leaves the whole chunk null.
	 */
	async embedDocuments(
		items: Array<{ content: string; title?: string }>,
	): Promise<Array<Float32Array | null>> {
		const results: Array<Float32Array | null> = new Array(items.length).fill(
			null,
		);
		if (items.length === 0) return results;
		if (this.isCircuitOpen()) return results;

		const authHeaders = await this.getAuthHeaders();
		if (!authHeaders) return results;

		const outputDims = this.requestedDimensions();
		const chunkSize = 100;

		for (let start = 0; start < items.length; start += chunkSize) {
			const chunk = items.slice(start, start + chunkSize);
			const requests = chunk.map((item) => {
				const formattedText = this.isEmbedding2()
					? GeminiSemanticSearch.prepareDocument(item.content, item.title)
					: item.content.trim();

				const request: Record<string, unknown> = {
					model: this.modelName,
					content: { parts: [{ text: formattedText }] },
					output_dimensionality: outputDims,
				};

				if (!this.isEmbedding2()) {
					request.task_type = 'RETRIEVAL_DOCUMENT';
					if (item.title && item.title.trim().length > 0) {
						request.title = item.title.trim();
					}
				}
				return request;
			});

			try {
				const response = await withRetry(
					async () => {
						await this.waitForCircuitClosed();
						return axios.post<{
							embeddings?: Array<{ values?: number[] }>;
						}>(
							`${this.baseUrl}/${this.modelName}:batchEmbedContents`,
							{ requests },
							{
								headers: {
									'Content-Type': 'application/json',
									...authHeaders,
								},
								timeout: 30000,
							},
						);
					},
					{
						attempts: 5,
						baseDelayMs: 1_000,
						maxDelayMs: 20_000,
						shouldRetry: (error) => this.isRetryableError(error),
						onRetry: (attempt, error, delayMs) => {
							const status = axios.isAxiosError(error)
								? error.response?.status
								: undefined;
							console.error(
								`   ⚠ batch retry ${attempt}/5 after HTTP ${status ?? 'network error'} (waiting ${delayMs}ms)`,
							);
							this.handleApiError(error, 'embedDocuments');
						},
					},
				);

				const embeddings = response.data?.embeddings ?? [];
				embeddings.forEach((embedding, offset) => {
					const vector = this.embeddingFromValues(
						embedding?.values,
						outputDims,
					);
					if (vector && vector.length === this.dimensions) {
						results[start + offset] = vector;
					}
				});
			} catch (err) {
				this.handleApiError(err, 'embedDocuments');
				// Leave the chunk as nulls: the caller retries per item.
			}
		}

		return results;
	}

	async embedMultimodal(
		text: string,
		imageBase64: string,
		mimeType = 'image/png',
	): Promise<Float32Array | null> {
		if (this.isCircuitOpen()) return null;
		const authHeaders = await this.getAuthHeaders();
		if (!authHeaders) return null;

		try {
			const url = `${this.baseUrl}/${this.modelName}:embedContent`;
			const parts: Array<
				{ text: string } | { inline_data: { mime_type: string; data: string } }
			> = [];
			// The text portion of a multimodal input must not carry a task instruction.
			const caption = stripMultimodalTaskPrefix(text ?? '');
			if (caption.length > 0) {
				parts.push({ text: caption });
			}
			if (imageBase64 && imageBase64.trim().length > 0) {
				let mime = mimeType.trim().toLowerCase();
				if (mime === 'image/jpg') mime = 'image/jpeg';
				if (!MULTIMODAL_MIME_TYPES.has(mime)) {
					console.warn(
						`Warning: Unsupported embedding MIME type "${mimeType}". Supported inputs are PNG, JPEG, MP4, MOV, MP3, WAV, and PDF.`,
					);
					return null;
				}
				parts.push({
					inline_data: {
						mime_type: mime,
						data: imageBase64.trim(),
					},
				});
			}
			if (parts.length === 0) return null;

			const outputDims = this.requestedDimensions();
			const response = await axios.post<{
				embedding?: { values?: number[] };
			}>(
				url,
				{
					content: { parts },
					output_dimensionality: outputDims,
				},
				{
					headers: {
						'Content-Type': 'application/json',
						...authHeaders,
					},
					timeout: 8000,
				},
			);

			return this.embeddingFromValues(
				response.data?.embedding?.values,
				outputDims,
			);
		} catch (err) {
			this.handleApiError(err, 'embedMultimodal');
			return null;
		}
	}

	cosineSimilarityWithNorm(
		a: Float32Array,
		normA: number,
		b: Float32Array,
		normB: number,
	): number {
		if (a.length !== b.length || a.length === 0) return 0;
		const denom = normA * normB;
		if (denom <= 0) return 0;
		let dot = 0.0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
		}
		return dot / denom;
	}

	cosineSimilarity(a: Float32Array, b: Float32Array): number {
		if (a.length !== b.length || a.length === 0) return 0;
		let normASq = 0.0;
		let normBSq = 0.0;
		for (let i = 0; i < a.length; i++) {
			normASq += a[i] * a[i];
			normBSq += b[i] * b[i];
		}
		return this.cosineSimilarityWithNorm(
			a,
			Math.sqrt(normASq),
			b,
			Math.sqrt(normBSq),
		);
	}
}
