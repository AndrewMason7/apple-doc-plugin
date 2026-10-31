# In-Process Local EmbeddingGemma 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable 100% offline, in-process semantic vector search for Apple Developer Documentation using `node-llama-cpp` and Google DeepMind's EmbeddingGemma 2 (`embeddinggemma-2-Q8_0.gguf`) with Apple Silicon Metal acceleration.

**Architecture:** Introduce an `EmbeddingProvider` abstraction that decouples vector generation from the Gemini REST API. Implement `LocalGemmaEmbeddingProvider` using `node-llama-cpp` to load the local GGUF model in-process and generate 768-dimensional L2-normalized embeddings with DeepMind's asymmetric task formatting. Integrate the provider into `HybridSearchEngine` and `build-index.ts` with automatic discovery and graceful fallback to Gemini or lexical FTS5.

**Tech Stack:** TypeScript, Node.js v26, `node-llama-cpp` v3, `better-sqlite3`, `axios`, Google DeepMind EmbeddingGemma 2 Q8_0 GGUF.

**Spec:** `docs/superpowers/specs/2026-10-30-local-embedding-gemma-in-process-design.md`

## Global Constraints

- Must run on Node.js 20+ with Apple Silicon arm64 Metal acceleration.
- EmbeddingGemma 2 native vector output dimension is 768.
- Model file location configurable via `APPLE_DOCS_EMBEDDING_MODEL_PATH`, defaulting to `/Users/andrew/Documents/GitHub/Models/embeddinggemma-2-Q8_0.gguf`.
- Zero disruption to lexical search: `search_symbols` must remain 100% offline and pass all tests without requiring any model file or credentials.
- Graceful degradation: if `node-llama-cpp` or the GGUF file is unavailable, fallback cleanly to Gemini (if configured) or lexical FTS5 search without crashing.

## Review Focus

1. **Missing GGUF File**: When `APPLE_DOCS_EMBEDDING_MODEL_PATH` points to a non-existent path, `isAvailable()` must return `false` without crashing, allowing fallback to Gemini or lexical search.
2. **Empty or Whitespace Queries**: Query strings that are empty or whitespace-only must return `null` immediately without initializing or calling the GGUF model.
3. **Task Prefix Idempotency**: Texts already prefixed with `task:` or `title:` must not be double-prefixed.
4. **Vector Normalization**: All returned vectors from `LocalGemmaEmbeddingProvider` must be unit length ($L_2 \approx 1.0$) for correct cosine similarity scoring.
5. **Circuit Breaker / Load Failure**: If model initialization or inference throws an unexpected error, the provider must catch it, log a warning, and return `null` to ensure `HybridSearchEngine` falls back to FTS5.

---

### Task 1: EmbeddingProvider Interface and Dependency Setup

**Files:**

- Modify: `package.json`
- Create: `src/server/services/search/embedding-provider.ts`
- Create: `test/embedding-provider.test.js`

**Interfaces:**

- Produces:

  ```typescript
  export interface EmbeddingProvider {
  	readonly id: 'local-gguf' | 'gemini';
  	readonly dimensions: number;
  	isAvailable(): boolean;
  	embedQuery(text: string): Promise<Float32Array | null>;
  	embedDocument(
  		content: string,
  		title?: string,
  	): Promise<Float32Array | null>;
  }
  ```

- [ ] **Step 1: Write the failing test for `EmbeddingProvider` interface and helpers**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmbeddingProvider } from '../dist/server/services/search/embedding-provider.js';

test('isEmbeddingProvider returns true for valid provider object', () => {
	const mock = {
		id: 'local-gguf',
		dimensions: 768,
		isAvailable: () => true,
		embedQuery: async () => new Float32Array(768),
		embedDocument: async () => new Float32Array(768),
	};
	assert.equal(isEmbeddingProvider(mock), true);
	assert.equal(isEmbeddingProvider(null), false);
	assert.equal(isEmbeddingProvider({}), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/embedding-provider.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Add `node-llama-cpp` to `package.json` and install**

```bash
npm install node-llama-cpp@^3.22.2
```

- [ ] **Step 4: Implement `src/server/services/search/embedding-provider.ts`**

Define `EmbeddingProvider` interface, type guards, and helper utilities:

```typescript
export interface EmbeddingProvider {
	readonly id: 'local-gguf' | 'gemini';
	readonly dimensions: number;
	isAvailable(): boolean;
	embedQuery(text: string): Promise<Float32Array | null>;
	embedDocument(content: string, title?: string): Promise<Float32Array | null>;
}

export function isEmbeddingProvider(obj: unknown): obj is EmbeddingProvider {
	if (!obj || typeof obj !== 'object') return false;
	const p = obj as EmbeddingProvider;
	return (
		(p.id === 'local-gguf' || p.id === 'gemini') &&
		typeof p.dimensions === 'number' &&
		typeof p.isAvailable === 'function' &&
		typeof p.embedQuery === 'function' &&
		typeof p.embedDocument === 'function'
	);
}
```

- [ ] **Step 5: Run build and tests**

Run: `npm run build && node --test test/embedding-provider.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/server/services/search/embedding-provider.ts test/embedding-provider.test.js
git commit -m "feat(search): define EmbeddingProvider interface and add node-llama-cpp dependency"
```

---

### Task 2: Implement LocalGemmaEmbeddingProvider

**Files:**

- Create: `src/server/services/search/local-gemma-provider.ts`
- Create: `test/local-gemma-provider.test.js`

**Interfaces:**

- Consumes: `EmbeddingProvider` from `src/server/services/search/embedding-provider.ts`
- Produces: `LocalGemmaEmbeddingProvider` class

- [ ] **Step 1: Write tests for prompt formatting and availability handling**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGemmaEmbeddingProvider } from '../dist/server/services/search/local-gemma-provider.js';

test('LocalGemmaEmbeddingProvider reports unavailable if model file does not exist', () => {
	const provider = new LocalGemmaEmbeddingProvider('/non/existent/model.gguf');
	assert.equal(provider.isAvailable(), false);
	assert.equal(provider.dimensions, 768);
});

test('LocalGemmaEmbeddingProvider formats query with task prefix', () => {
	assert.equal(
		LocalGemmaEmbeddingProvider.prepareQuery('NavigationSplitView'),
		'task: search result | query: NavigationSplitView',
	);
	assert.equal(
		LocalGemmaEmbeddingProvider.prepareQuery(
			'task: code retrieval | query: test',
		),
		'task: code retrieval | query: test',
	);
});

test('LocalGemmaEmbeddingProvider formats document with title prefix', () => {
	assert.equal(
		LocalGemmaEmbeddingProvider.prepareDocument(
			'A container view',
			'NavigationStack',
		),
		'title: NavigationStack | text: A container view',
	);
	assert.equal(
		LocalGemmaEmbeddingProvider.prepareDocument('Standalone text'),
		'title: none | text: Standalone text',
	);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/local-gemma-provider.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `LocalGemmaEmbeddingProvider` in `src/server/services/search/local-gemma-provider.ts`**

Implement lazy loading of `node-llama-cpp`:

- `getLlama()` initialization.
- `model = await llama.loadModel({ modelPath })`.
- `context = await model.createEmbeddingContext()`.
- L2 normalization of vectors.
- Error boundary catching missing model or inference issues.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test test/local-gemma-provider.test.js`
Expected: PASS

- [ ] **Step 5: Add live inference test when model is present on disk**

Add test in `test/local-gemma-provider.test.js` that checks live embedding when `/Users/andrew/Documents/GitHub/Models/embeddinggemma-2-Q8_0.gguf` exists:

- Verifies returned vector has length 768.
- Verifies returned vector has norm $\approx 1.0$.

- [ ] **Step 6: Run tests and verify**

Run: `npm run test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/services/search/local-gemma-provider.ts test/local-gemma-provider.test.js
git commit -m "feat(search): implement in-process LocalGemmaEmbeddingProvider with node-llama-cpp"
```

---

### Task 3: Adapt GeminiSemanticSearch and Factory Provider Discovery

**Files:**

- Modify: `src/server/services/search/semantic-search.ts`
- Create: `src/server/services/search/provider-factory.ts`
- Create: `test/provider-factory.test.js`

**Interfaces:**

- Consumes: `LocalGemmaEmbeddingProvider`, `GeminiSemanticSearch`, `EmbeddingProvider`
- Produces: `resolveEmbeddingProvider(options?: ProviderOptions): EmbeddingProvider`

- [ ] **Step 1: Write tests for provider resolution priority**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmbeddingProvider } from '../dist/server/services/search/provider-factory.js';

test('resolveEmbeddingProvider selects local GGUF when model exists', () => {
	const provider = resolveEmbeddingProvider({
		localModelPath:
			'/Users/andrew/Documents/GitHub/Models/embeddinggemma-2-Q8_0.gguf',
		forceLocal: true,
	});
	assert.equal(provider.id, 'local-gguf');
	assert.equal(provider.dimensions, 768);
});

test('resolveEmbeddingProvider falls back to Gemini when local model is absent but API key is set', () => {
	const provider = resolveEmbeddingProvider({
		localModelPath: '/non/existent.gguf',
		geminiApiKey: 'test-key',
	});
	assert.equal(provider.id, 'gemini');
	assert.equal(provider.dimensions, 3072);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/provider-factory.test.js`
Expected: FAIL

- [ ] **Step 3: Update `GeminiSemanticSearch` to implement `EmbeddingProvider`**

Add `readonly id = 'gemini'` and `readonly dimensions = 3072` (or configured dimensions), and `isAvailable(): boolean` returning `this.hasAuth()`.

- [ ] **Step 4: Implement `src/server/services/search/provider-factory.ts`**

Implement `resolveEmbeddingProvider` with order of precedence:

1. `APPLE_DOCS_EMBEDDING_PROVIDER === 'gemini'` forces Gemini.
2. If local GGUF model exists at `APPLE_DOCS_EMBEDDING_MODEL_PATH` or `/Users/andrew/Documents/GitHub/Models/embeddinggemma-2-Q8_0.gguf`, use `LocalGemmaEmbeddingProvider`.
3. If Gemini auth exists (`GEMINI_API_KEY` or ADC), use `GeminiSemanticSearch`.
4. Otherwise, return fallback dummy provider (or null) where `isAvailable() === false`.

- [ ] **Step 5: Run tests and verify**

Run: `npm run build && node --test test/provider-factory.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/services/search/semantic-search.ts src/server/services/search/provider-factory.ts test/provider-factory.test.js
git commit -m "feat(search): make GeminiSemanticSearch an EmbeddingProvider and add provider-factory"
```

---

### Task 4: Integrate Provider into HybridSearchEngine and build-index

**Files:**

- Modify: `src/server/services/search/hybrid-search.ts`
- Modify: `scripts/build-index.ts`
- Modify: `test/search.test.js`

**Interfaces:**

- Consumes: `EmbeddingProvider`
- Modifies: `HybridSearchEngine` accepts `EmbeddingProvider`

- [ ] **Step 1: Write test for `HybridSearchEngine` using local provider**

```javascript
test('HybridSearchEngine works seamlessly with 768-dimensional local provider', async () => {
	const mockLocal = {
		id: 'local-gguf',
		dimensions: 768,
		isAvailable: () => true,
		embedQuery: async () => new Float32Array(768).fill(0.01),
		embedDocument: async () => new Float32Array(768).fill(0.01),
	};
	const engine = new HybridSearchEngine(db, { embeddingProvider: mockLocal });
	const results = await engine.search('Navigation', { preferSemantic: true });
	assert.ok(Array.isArray(results));
});
```

- [ ] **Step 2: Run test to verify failure/compile error**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Update `HybridSearchEngine` to consume `EmbeddingProvider`**

In `src/server/services/search/hybrid-search.ts`:

- Replace direct `GeminiSemanticSearch` member with `EmbeddingProvider`.
- Check `provider.isAvailable()` before attempting `embedQuery`.
- Maintain backwards compatibility for existing options.

- [ ] **Step 4: Update `scripts/build-index.ts`**

Update `build-index.ts` to log the active embedding provider and dimension (e.g. `✨ Mode: Hybrid (Local EmbeddingGemma 2 GGUF detected, 768-d vector embeddings enabled)`).

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/services/search/hybrid-search.ts scripts/build-index.ts test/search.test.js
git commit -m "refactor(search): wire EmbeddingProvider into HybridSearchEngine and build-index"
```

---

### Task 5: End-to-End Verification & Documentation Update

**Files:**

- Modify: `README.md`
- Modify: `.env.example`
- Create: `test/local-e2e.test.js`

- [ ] **Step 1: Create end-to-end test verifying local model workflow**

Verify querying `semantic_search` end-to-end with local GGUF provider enabled.

- [ ] **Step 2: Update `.env.example` and `README.md`**

Document:

- `APPLE_DOCS_EMBEDDING_MODEL_PATH`
- `APPLE_DOCS_EMBEDDING_PROVIDER` (`local` vs `gemini`)
- Explain 100% offline local mode with EmbeddingGemma 2 via `node-llama-cpp`.

- [ ] **Step 3: Run full verification suite and check linter**

Run:

```bash
npm run check
npm run test
```

Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example test/local-e2e.test.js
git commit -m "docs: document in-process local EmbeddingGemma 2 setup and verify e2e"
```
