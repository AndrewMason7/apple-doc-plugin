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
export declare class GeminiSemanticSearch {
    private readonly apiKey?;
    private readonly modelName;
    private readonly baseUrl;
    private circuitOpenUntil;
    constructor(apiKey?: string | null, modelName?: string, baseUrl?: string);
    hasApiKey(): boolean;
    isCircuitOpen(): boolean;
    tripCircuitBreaker(durationMs?: number): void;
    resetCircuitBreaker(): void;
    private handleApiError;
    embedQuery(text: string): Promise<Float32Array | null>;
    embedMultimodal(text: string, imageBase64: string, mimeType?: string): Promise<Float32Array | null>;
    cosineSimilarity(a: Float32Array, b: Float32Array): number;
}
