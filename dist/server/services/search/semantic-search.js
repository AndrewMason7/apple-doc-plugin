import axios from 'axios';
export class GeminiSemanticSearch {
    apiKey;
    modelName;
    baseUrl;
    circuitOpenUntil = 0;
    constructor(apiKey, modelName = 'models/gemini-embedding-2', baseUrl = 'https://generativelanguage.googleapis.com/v1beta') {
        if (apiKey === null) {
            this.apiKey = undefined;
        }
        else {
            this.apiKey = apiKey || process.env.GEMINI_API_KEY;
        }
        this.modelName = modelName;
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }
    hasApiKey() {
        return Boolean(this.apiKey && this.apiKey.trim().length > 0);
    }
    isCircuitOpen() {
        return Date.now() < this.circuitOpenUntil;
    }
    tripCircuitBreaker(durationMs = 30_000) {
        this.circuitOpenUntil = Date.now() + durationMs;
    }
    resetCircuitBreaker() {
        this.circuitOpenUntil = 0;
    }
    handleApiError(err, action) {
        if (axios.isAxiosError(err)) {
            const status = err.response?.status;
            if (status === 429 || (status !== undefined && status >= 500)) {
                this.tripCircuitBreaker(30_000);
                console.error(`Warning: Gemini API error (${status}) during ${action}. Circuit breaker tripped for 30s.`);
                return;
            }
        }
        console.error(`Warning: Gemini API call failed during ${action}:`, err instanceof Error ? err.message : err);
    }
    async embedQuery(text) {
        if (!this.hasApiKey() || this.isCircuitOpen())
            return null;
        try {
            const url = `${this.baseUrl}/${this.modelName}:embedContent`;
            const response = await axios.post(url, {
                content: { parts: [{ text }] },
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': this.apiKey,
                },
                timeout: 4000,
            });
            const values = response.data?.embedding?.values;
            if (!Array.isArray(values))
                return null;
            return new Float32Array(values);
        }
        catch (err) {
            this.handleApiError(err, 'embedQuery');
            return null;
        }
    }
    async embedMultimodal(text, imageBase64, mimeType = 'image/png') {
        if (!this.hasApiKey() || this.isCircuitOpen())
            return null;
        try {
            const url = `${this.baseUrl}/${this.modelName}:embedContent`;
            const parts = [];
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
            const response = await axios.post(url, {
                content: { parts },
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': this.apiKey,
                },
                timeout: 8000,
            });
            const values = response.data?.embedding?.values;
            if (!Array.isArray(values))
                return null;
            return new Float32Array(values);
        }
        catch (err) {
            this.handleApiError(err, 'embedMultimodal');
            return null;
        }
    }
    cosineSimilarity(a, b) {
        if (a.length !== b.length || a.length === 0)
            return 0;
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
//# sourceMappingURL=semantic-search.js.map