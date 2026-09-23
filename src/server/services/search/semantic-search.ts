import axios from 'axios';

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

export class GeminiSemanticSearch {
  private readonly apiKey?: string;
  private readonly modelName: string;
  private readonly baseUrl: string;
  private circuitOpenUntil = 0;

  constructor(
    apiKey?: string | null,
    modelName = 'models/gemini-embedding-2',
    baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
  ) {
    if (apiKey === null) {
      this.apiKey = undefined;
    } else {
      this.apiKey = apiKey || process.env.GEMINI_API_KEY;
    }
    this.modelName = modelName;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  hasApiKey(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
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
      if (status === 429 || (status !== undefined && status >= 500)) {
        this.tripCircuitBreaker(30_000);
        console.error(
          `Warning: Gemini API error (${status}) during ${action}. Circuit breaker tripped for 30s.`
        );
        return;
      }
    }
    console.error(
      `Warning: Gemini API call failed during ${action}:`,
      err instanceof Error ? err.message : err
    );
  }

  async embedQuery(text: string): Promise<Float32Array | null> {
    if (!this.hasApiKey() || this.isCircuitOpen()) return null;
    try {
      const url = `${this.baseUrl}/${this.modelName}:embedContent`;
      const response = await axios.post(
        url,
        {
          content: { parts: [{ text }] },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey!,
          },
          timeout: 4000,
        }
      );
      const values = response.data?.embedding?.values;
      if (!Array.isArray(values)) return null;
      return new Float32Array(values);
    } catch (err) {
      this.handleApiError(err, 'embedQuery');
      return null;
    }
  }

  async embedMultimodal(
    text: string,
    imageBase64: string,
    mimeType = 'image/png'
  ): Promise<Float32Array | null> {
    if (!this.hasApiKey() || this.isCircuitOpen()) return null;
    try {
      const url = `${this.baseUrl}/${this.modelName}:embedContent`;
      const parts: any[] = [];
      if (text && text.trim().length > 0) {
        parts.push({ text: text.trim() });
      }
      if (imageBase64 && imageBase64.trim().length > 0) {
        parts.push({
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        });
      }

      const response = await axios.post(
        url,
        {
          content: { parts },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey!,
          },
          timeout: 8000,
        }
      );
      const values = response.data?.embedding?.values;
      if (!Array.isArray(values)) return null;
      return new Float32Array(values);
    } catch (err) {
      this.handleApiError(err, 'embedMultimodal');
      return null;
    }
  }

  cosineSimilarityWithNorm(
    a: Float32Array,
    normA: number,
    b: Float32Array,
    normB: number
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
    return this.cosineSimilarityWithNorm(a, Math.sqrt(normASq), b, Math.sqrt(normBSq));
  }
}

