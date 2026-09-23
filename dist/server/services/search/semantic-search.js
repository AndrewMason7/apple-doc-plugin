import axios from 'axios';
export class GeminiSemanticSearch {
    apiKey;
    modelName;
    constructor(apiKey, modelName = 'models/gemini-embedding-2') {
        if (apiKey === null) {
            this.apiKey = undefined;
        }
        else {
            this.apiKey = apiKey || process.env.GEMINI_API_KEY;
        }
        this.modelName = modelName;
    }
    hasApiKey() {
        return Boolean(this.apiKey && this.apiKey.trim().length > 0);
    }
    async embedQuery(text) {
        if (!this.hasApiKey())
            return null;
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/${this.modelName}:embedContent?key=${this.apiKey}`;
            const response = await axios.post(url, {
                content: { parts: [{ text }] },
            }, { timeout: 4000 });
            const values = response.data?.embedding?.values;
            if (!Array.isArray(values))
                return null;
            return new Float32Array(values);
        }
        catch (err) {
            console.error('Warning: Gemini embedding failed, falling back to lexical search:', err instanceof Error ? err.message : err);
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