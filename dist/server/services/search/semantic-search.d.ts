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
        getAccessToken(): Promise<{
            token?: string | null;
        } | string | null>;
    }>;
}
export declare class GeminiSemanticSearch {
    private readonly apiKey?;
    private readonly modelName;
    private readonly baseUrl;
    private readonly googleAuth;
    private readonly hasInjectedAuth;
    private readonly authDisabled;
    private circuitOpenUntil;
    private cachedAccessToken;
    readonly expectedDimensions?: number;
    constructor(apiKey?: string | null, modelName?: string, baseUrl?: string, googleAuth?: GoogleAuthClient, expectedDimensions?: number);
    hasApiKey(): boolean;
    hasAdc(): boolean;
    hasAuth(): boolean;
    getAuthHeaders(): Promise<Record<string, string> | null>;
    isCircuitOpen(): boolean;
    tripCircuitBreaker(durationMs?: number): void;
    resetCircuitBreaker(): void;
    private handleApiError;
    /**
     * Formats query string according to official Gemini Embedding 2 asymmetric retrieval prompt guidelines:
     * `task: search result | query: {query}`
     */
    static prepareQuery(query: string, task?: string): string;
    /**
     * Formats document string according to official Gemini Embedding 2 asymmetric retrieval guidelines:
     * `title: {title} | text: {content}` (or `title: none | text: {content}`)
     */
    static prepareDocument(content: string, title?: string): string;
    /**
     * Gemini Embedding 2 takes task instructions in the prompt and rejects task_type.
     * Every other model, including gemini-embedding-001, uses the task_type field.
     */
    isEmbedding2(): boolean;
    private requestedDimensions;
    private embeddingFromValues;
    embedQuery(text: string): Promise<Float32Array | null>;
    embedDocument(content: string, title?: string): Promise<Float32Array | null>;
    embedMultimodal(text: string, imageBase64: string, mimeType?: string): Promise<Float32Array | null>;
    cosineSimilarityWithNorm(a: Float32Array, normA: number, b: Float32Array, normB: number): number;
    cosineSimilarity(a: Float32Array, b: Float32Array): number;
}
