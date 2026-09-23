import assert from 'node:assert';
import test from 'node:test';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';

test('GeminiSemanticSearch validates embedMultimodal interface', async () => {
	const search = new GeminiSemanticSearch(null); // disabled API
	const res = await search.embedMultimodal(
		'Sample caption',
		'base64data',
		'image/png',
	);
	assert.strictEqual(res, null); // Graceful null when no API key
});
