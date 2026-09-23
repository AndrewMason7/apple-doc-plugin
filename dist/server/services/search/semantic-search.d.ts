export interface SemanticMatch {
    id: string;
    framework: string;
    title: string;
    kind: string;
    summary: string;
    path: string;
    similarity: number;
}
export declare class GeminiSemanticSearch {
    private readonly apiKey?;
    private readonly modelName;
    constructor(apiKey?: string | null, modelName?: string);
    hasApiKey(): boolean;
    embedQuery(text: string): Promise<Float32Array | null>;
    cosineSimilarity(a: Float32Array, b: Float32Array): number;
}
