import axios from 'axios';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GoogleAuth } from 'google-auth-library';

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

export class GeminiSemanticSearch {
  private readonly apiKey?: string;
  private readonly modelName: string;
  private readonly baseUrl: string;
  private readonly googleAuth: GoogleAuthClient;
  private readonly hasInjectedAuth: boolean;
  private readonly authDisabled: boolean;
  private circuitOpenUntil = 0;
  private cachedAccessToken: { token: string; expiresAt: number } | null = null;

  constructor(
    apiKey?: string | null,
    modelName = 'models/gemini-embedding-2',
    baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
    googleAuth?: GoogleAuthClient
  ) {
    if (apiKey === null && !googleAuth) {
      this.apiKey = undefined;
      this.authDisabled = true;
    } else {
      this.apiKey = apiKey === null ? undefined : apiKey || process.env.GEMINI_API_KEY;
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
      return true;
    }
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) {
      const defaultGcloudPath = join(home, '.config/gcloud/application_default_credentials.json');
      if (existsSync(defaultGcloudPath)) {
        return true;
      }
    }
    if (process.env.GOOGLE_CLOUD_PROJECT || process.env.K_SERVICE || process.env.GAE_SERVICE) {
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
      if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > now + 60_000) {
        return { Authorization: `Bearer ${this.cachedAccessToken.token}` };
      }

      const client = await this.googleAuth.getClient();
      const tokenResult = await client.getAccessToken();
      const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;
      if (token && typeof token === 'string' && token.trim().length > 0) {
        this.cachedAccessToken = {
          token,
          expiresAt: now + 50 * 60 * 1000,
        };
        return { Authorization: `Bearer ${token}` };
      }
    } catch {
      // ADC unavailable or error fetching credentials
    }

    return null;
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
        err.code === 'ECONNABORTED' || err.message.toLowerCase().includes('timeout');
      const isNetworkError =
        err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED';
      const isAuthError = status === 401 || status === 403;
      const isRateLimitOrServer = status === 429 || (status !== undefined && status >= 500);

      if (isTimeout || isNetworkError || isAuthError || isRateLimitOrServer) {
        this.tripCircuitBreaker(30_000);
        console.error(
          `Warning: Gemini API error (${status || err.code || 'timeout'}) during ${action}. Circuit breaker tripped for 30s.`
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
    if (this.isCircuitOpen()) return null;
    const authHeaders = await this.getAuthHeaders();
    if (!authHeaders) return null;

    try {
      const url = `${this.baseUrl}/${this.modelName}:embedContent`;
      const response = await axios.post(
        url,
        {
          content: { parts: [{ text }] },
          outputDimensionality: 3072,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
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
    if (this.isCircuitOpen()) return null;
    const authHeaders = await this.getAuthHeaders();
    if (!authHeaders) return null;

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
          outputDimensionality: 3072,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
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
