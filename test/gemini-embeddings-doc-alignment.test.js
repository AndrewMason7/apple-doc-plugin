import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';

test('GeminiSemanticSearch static helpers format prompts according to official docs', () => {
	// Query structure: task: search result | query: {content}
	assert.strictEqual(
		GeminiSemanticSearch.prepareQuery('NavigationStack path binding'),
		'task: search result | query: NavigationStack path binding',
	);
	// No double-prefixing if already formatted
	assert.strictEqual(
		GeminiSemanticSearch.prepareQuery('task: search result | query: List selection'),
		'task: search result | query: List selection',
	);
	// Custom task support (e.g., code retrieval)
	assert.strictEqual(
		GeminiSemanticSearch.prepareQuery('func makeUIViewController', 'code retrieval'),
		'task: code retrieval | query: func makeUIViewController',
	);

	// Document structure: title: {title} | text: {content}
	assert.strictEqual(
		GeminiSemanticSearch.prepareDocument('Declare UI for Apple platforms.', 'SwiftUI'),
		'title: SwiftUI | text: Declare UI for Apple platforms.',
	);
	// Missing or empty title defaults to 'none' per documentation table
	assert.strictEqual(
		GeminiSemanticSearch.prepareDocument('Standalone code snippet.'),
		'title: none | text: Standalone code snippet.',
	);
	assert.strictEqual(
		GeminiSemanticSearch.prepareDocument('Standalone code snippet.', ''),
		'title: none | text: Standalone code snippet.',
	);
	// No double-prefixing if already formatted
	assert.strictEqual(
		GeminiSemanticSearch.prepareDocument('title: UIKit | text: Legacy views.'),
		'title: UIKit | text: Legacy views.',
	);
});

test('GeminiSemanticSearch: gemini-embedding-2 formats asymmetric query and omits task_type', async () => {
	let receivedBody = null;
	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => {
			raw += chunk;
		});
		req.on('end', () => {
			receivedBody = JSON.parse(raw);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }));
		});
	});

	await new Promise((resolve) => server.listen(0, resolve));
	const port = server.address().port;
	const baseUrl = `http://127.0.0.1:${port}`;

	try {
		const search = new GeminiSemanticSearch(
			'test-key',
			'models/gemini-embedding-2',
			baseUrl,
		);
		const vec = await search.embedQuery('how to use LazyVGrid');
		assert(vec instanceof Float32Array);
		assert(receivedBody !== null);

		// Must format prompt as asymmetric query
		assert.strictEqual(
			receivedBody.content.parts[0].text,
			'task: search result | query: how to use LazyVGrid',
		);
		// Must send output_dimensionality: 3072
		assert.strictEqual(receivedBody.output_dimensionality, 3072);
		// gemini-embedding-2 must NOT contain task_type parameter
		assert.strictEqual(receivedBody.task_type, undefined);
		assert.strictEqual(receivedBody.taskType, undefined);
	} finally {
		server.close();
	}
});

test('GeminiSemanticSearch: gemini-embedding-2 formats document ingestion prompt', async () => {
	let receivedBody = null;
	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => {
			raw += chunk;
		});
		req.on('end', () => {
			receivedBody = JSON.parse(raw);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ embedding: { values: [0.4, 0.5, 0.6] } }));
		});
	});

	await new Promise((resolve) => server.listen(0, resolve));
	const port = server.address().port;
	const baseUrl = `http://127.0.0.1:${port}`;

	try {
		const search = new GeminiSemanticSearch(
			'test-key',
			'models/gemini-embedding-2',
			baseUrl,
		);
		const vec = await search.embedDocument(
			'Declarative view hierarchy with state management.',
			'SwiftUI',
		);
		assert(vec instanceof Float32Array);
		assert(receivedBody !== null);

		// Must format prompt as title: {title} | text: {content}
		assert.strictEqual(
			receivedBody.content.parts[0].text,
			'title: SwiftUI | text: Declarative view hierarchy with state management.',
		);
		assert.strictEqual(receivedBody.output_dimensionality, 3072);
		assert.strictEqual(receivedBody.task_type, undefined);
	} finally {
		server.close();
	}
});

test('GeminiSemanticSearch: gemini-embedding-001 uses task_type parameter without prompt prefix', async () => {
	let receivedBodyQuery = null;
	let receivedBodyDoc = null;
	let callCount = 0;

	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => {
			raw += chunk;
		});
		req.on('end', () => {
			callCount++;
			if (callCount === 1) {
				receivedBodyQuery = JSON.parse(raw);
			} else {
				receivedBodyDoc = JSON.parse(raw);
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ embedding: { values: [0.1, 0.2] } }));
		});
	});

	await new Promise((resolve) => server.listen(0, resolve));
	const port = server.address().port;
	const baseUrl = `http://127.0.0.1:${port}`;

	try {
		const search = new GeminiSemanticSearch(
			'test-key',
			'models/gemini-embedding-001',
			baseUrl,
		);

		await search.embedQuery('search query for legacy');
		assert(receivedBodyQuery !== null);
		// Legacy model: text is unmodified
		assert.strictEqual(
			receivedBodyQuery.content.parts[0].text,
			'search query for legacy',
		);
		// Legacy model: sets task_type RETRIEVAL_QUERY
		assert.strictEqual(receivedBodyQuery.task_type, 'RETRIEVAL_QUERY');

		await search.embedDocument('document text for legacy', 'DocTitle');
		assert(receivedBodyDoc !== null);
		assert.strictEqual(
			receivedBodyDoc.content.parts[0].text,
			'document text for legacy',
		);
		assert.strictEqual(receivedBodyDoc.task_type, 'RETRIEVAL_DOCUMENT');
		assert.strictEqual(receivedBodyDoc.title, 'DocTitle');
	} finally {
		server.close();
	}
});

test('GeminiSemanticSearch: embedMultimodal sends inline_data and leaves text caption clean', async () => {
	let receivedBody = null;
	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => {
			raw += chunk;
		});
		req.on('end', () => {
			receivedBody = JSON.parse(raw);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			const mockEmbedding = new Array(768).fill(0.1);
			res.end(JSON.stringify({ embedding: { values: mockEmbedding } }));
		});
	});

	await new Promise((resolve) => server.listen(0, resolve));
	const port = server.address().port;
	const baseUrl = `http://127.0.0.1:${port}`;

	try {
		const search = new GeminiSemanticSearch(
			'test-key',
			'models/gemini-embedding-2',
			baseUrl,
			undefined,
			768, // MRL truncated dimensions
		);

		const vec = await search.embedMultimodal(
			'A screenshot of a SwiftUI NavigationSplitView layout',
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
			'image/png',
		);
		assert(vec instanceof Float32Array);
		assert.strictEqual(vec.length, 768);
		assert(receivedBody !== null);

		// Text part must NOT include task prefix per doc note:
		// "The text portion of the multimodal input shouldn't include task type information."
		assert.strictEqual(
			receivedBody.content.parts[0].text,
			'A screenshot of a SwiftUI NavigationSplitView layout',
		);
		// Multimodal inline_data structure per REST curl docs
		assert.deepStrictEqual(receivedBody.content.parts[1], {
			inline_data: {
				mime_type: 'image/png',
				data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
			},
		});
		// MRL dimension control
		assert.strictEqual(receivedBody.output_dimensionality, 768);
	} finally {
		server.close();
	}
});
