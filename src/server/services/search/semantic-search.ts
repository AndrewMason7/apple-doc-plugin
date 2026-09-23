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

  constructor(apiKey?: string | null, modelName = 'models/gemini-embedding-2') {
    if (apiKey === null) {
      this.apiKey = undefined;
    } else {
      this.apiKey = apiKey || process.env.GEMINI_API_KEY;
    }
    this.modelName = modelName;
  }

  hasApiKey(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async embedQuery(text: string): Promise<Float32Array | null> {
    if (!this.hasApiKey()) return null;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${this.modelName}:embedContent?key=${this.apiKey}`;
      const response = await axios.post(
        url,
        {
          content: { parts: [{ text }] },
        },
        { timeout: 4000 }
      );
      const values = response.data?.embedding?.values;
      if (!Array.isArray(values)) return null;
      return new Float32Array(values);
    } catch (err) {
      console.error(
        'Warning: Gemini embedding failed, falling back to lexical search:',
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  async embedMultimodal(
    text: string,
    imageBase64: string,
    mimeType = 'image/png'
  ): Promise<Float32Array | null> {
    if (!this.hasApiKey()) return null;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${this.modelName}:embedContent?key=${this.apiKey}`;
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
        { timeout: 8000 }
      );
      const values = response.data?.embedding?.values;
      if (!Array.isArray(values)) return null;
      return new Float32Array(values);
    } catch (err) {
      console.error(
        'Warning: Gemini multimodal embedding failed:',
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }
}
