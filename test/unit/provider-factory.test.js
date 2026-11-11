import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveEmbeddingProvider } from '../../dist/server/services/search/provider-factory.js';
import { getDefaultLocalModelPath } from '../../dist/server/services/search/local-gemma-provider.js';

const LOCAL_MODEL =
	process.env.APPLE_DOCS_EMBEDDING_MODEL_PATH || getDefaultLocalModelPath();

test('resolveEmbeddingProvider prefers Gemini when API key is present even if local model exists', () => {
	const provider = resolveEmbeddingProvider({
		localModelPath: LOCAL_MODEL,
		geminiApiKey: 'test-key',
	});
	assert.equal(provider.id, 'gemini');
	assert.equal(provider.dimensions, 768);
});

test('resolveEmbeddingProvider selects local GGUF when Gemini is absent but local model exists', (t) => {
	if (!existsSync(LOCAL_MODEL)) {
		// The GGUF only exists on the author's Mac; skip rather than fail CI/VPS.
		t.skip(`local GGUF model not present at ${LOCAL_MODEL}`);
		return;
	}
	const provider = resolveEmbeddingProvider({
		localModelPath: LOCAL_MODEL,
		geminiApiKey: null,
		disableAdc: true,
	});
	assert.equal(provider.id, 'local-gguf');
	assert.equal(provider.dimensions, 768);
});

test('resolveEmbeddingProvider respects APPLE_DOCS_EMBEDDING_PROVIDER=local override', (t) => {
	if (!existsSync(LOCAL_MODEL)) {
		t.skip(`local GGUF model not present at ${LOCAL_MODEL}`);
		return;
	}
	const provider = resolveEmbeddingProvider({
		preferredProvider: 'local',
		localModelPath: LOCAL_MODEL,
		geminiApiKey: 'test-key',
	});
	assert.equal(provider.id, 'local-gguf');
});

test('resolveEmbeddingProvider returns unavailable provider when neither is present', () => {
	const provider = resolveEmbeddingProvider({
		localModelPath: '/non/existent.gguf',
		geminiApiKey: null,
		disableAdc: true,
	});
	assert.equal(provider.isAvailable(), false);
});

test('resolveEmbeddingProvider honours APPLE_DOCS_DISABLE_ADC=1 even when ambient ADC exists (bridge isolation)', () => {
	// Deterministically simulate ambient ADC: hasAdc() only checks that the
	// GOOGLE_APPLICATION_CREDENTIALS file exists, so a temp file makes this
	// test meaningful on any machine (clean CI included).
	const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'apple-docs-adc-'));
	const adcPath = path.join(tmpDir, 'application_default_credentials.json');
	writeFileSync(adcPath, '{"type":"authorized_user"}');
	const prevAdc = process.env.APPLE_DOCS_DISABLE_ADC;
	const prevKey = process.env.GEMINI_API_KEY;
	const prevGac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
	process.env.APPLE_DOCS_DISABLE_ADC = '1';
	process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
	delete process.env.GEMINI_API_KEY;
	try {
		const provider = resolveEmbeddingProvider({
			localModelPath: '/non/existent.gguf',
		});
		// Ambient ADC present but the bridge forbids it: must NOT authenticate.
		assert.equal(provider.isAvailable(), false);
	} finally {
		if (prevAdc === undefined) delete process.env.APPLE_DOCS_DISABLE_ADC;
		else process.env.APPLE_DOCS_DISABLE_ADC = prevAdc;
		if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
		else process.env.GEMINI_API_KEY = prevKey;
		if (prevGac === undefined)
			delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
		else process.env.GOOGLE_APPLICATION_CREDENTIALS = prevGac;
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test('resolveEmbeddingProvider selects Gemini via ambient ADC when ADC is allowed (standalone mode)', () => {
	const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'apple-docs-adc-'));
	const adcPath = path.join(tmpDir, 'application_default_credentials.json');
	writeFileSync(adcPath, '{"type":"authorized_user"}');
	const prevAdc = process.env.APPLE_DOCS_DISABLE_ADC;
	const prevKey = process.env.GEMINI_API_KEY;
	const prevGac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
	delete process.env.APPLE_DOCS_DISABLE_ADC;
	process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
	delete process.env.GEMINI_API_KEY;
	try {
		const provider = resolveEmbeddingProvider({
			localModelPath: '/non/existent.gguf',
		});
		// No bridge flag: standalone users keep ADC support.
		assert.equal(provider.id, 'gemini');
		assert.equal(provider.isAvailable(), true);
	} finally {
		if (prevAdc === undefined) delete process.env.APPLE_DOCS_DISABLE_ADC;
		else process.env.APPLE_DOCS_DISABLE_ADC = prevAdc;
		if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
		else process.env.GEMINI_API_KEY = prevKey;
		if (prevGac === undefined)
			delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
		else process.env.GOOGLE_APPLICATION_CREDENTIALS = prevGac;
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

test('resolveEmbeddingProvider still accepts a bridge-injected GEMINI_API_KEY with ADC disabled', () => {
	const prevAdc = process.env.APPLE_DOCS_DISABLE_ADC;
	const prevKey = process.env.GEMINI_API_KEY;
	process.env.APPLE_DOCS_DISABLE_ADC = '1';
	process.env.GEMINI_API_KEY = 'bridge-secret-scope-key';
	try {
		const provider = resolveEmbeddingProvider({
			localModelPath: '/non/existent.gguf',
		});
		assert.equal(provider.id, 'gemini');
		assert.equal(provider.isAvailable(), true);
	} finally {
		if (prevAdc === undefined) delete process.env.APPLE_DOCS_DISABLE_ADC;
		else process.env.APPLE_DOCS_DISABLE_ADC = prevAdc;
		if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
		else process.env.GEMINI_API_KEY = prevKey;
	}
});
