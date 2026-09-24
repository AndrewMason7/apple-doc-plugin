import assert from 'node:assert';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { ServerState } from '../dist/server/state.js';
import { registerTools } from '../dist/server/tools.js';
import { GeminiSemanticSearch } from '../dist/server/services/search/semantic-search.js';

test('CallTool returns isError for an unknown tool and for a handler exception', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A view.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS'],
		isPrimaryType: true,
	});

	const server = new Server(
		{ name: 'apple-docs-test', version: '0.0.0' },
		{ capabilities: { tools: {} } },
	);
	registerTools(server, {
		client: {},
		state: new ServerState(),
		db,
		searchEngine: {
			search: async () => {
				throw new Error('search exploded');
			},
		},
	});

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '0.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const listed = await client.listTools();
		assert.ok(listed.tools.some((tool) => tool.name === 'search_symbols'));
		assert.ok(listed.tools.some((tool) => tool.name === 'semantic_search'));
		assert.ok(listed.tools.some((tool) => tool.name === 'get_documentation'));

		const unknown = await client.callTool({
			name: 'not_a_tool',
			arguments: {},
		});
		assert.strictEqual(unknown.isError, true);
		assert.match(unknown.content[0].text, /Unknown tool: not_a_tool/);

		const exploded = await client.callTool({
			name: 'search_symbols',
			arguments: { query: 'View' },
		});
		assert.strictEqual(exploded.isError, true);
		assert.match(exploded.content[0].text, /search exploded/);
	} finally {
		await client.close();
		await server.close();
		db.close();
	}
});

test('hasAdc ignores a missing credentials file and accepts a real one', () => {
	const saved = process.env.GOOGLE_APPLICATION_CREDENTIALS;
	const savedCloud = {
		K_SERVICE: process.env.K_SERVICE,
		GAE_SERVICE: process.env.GAE_SERVICE,
		CLOUD_RUN_JOB: process.env.CLOUD_RUN_JOB,
	};
	const dir = mkdtempSync(join(tmpdir(), 'adc-test-'));
	const present = join(dir, 'adc.json');
	writeFileSync(present, '{}');
	const search = new GeminiSemanticSearch(
		undefined,
		'models/test',
		'http://127.0.0.1',
	);

	try {
		delete process.env.K_SERVICE;
		delete process.env.GAE_SERVICE;
		delete process.env.CLOUD_RUN_JOB;
		process.env.GOOGLE_APPLICATION_CREDENTIALS = join(dir, 'missing.json');
		const gcloud = join(
			process.env.HOME || '',
			'.config/gcloud/application_default_credentials.json',
		);
		// The missing path itself must not force hasAdc true.
		if (!existsSync(gcloud)) {
			assert.strictEqual(search.hasAdc(), false);
		}
		process.env.GOOGLE_APPLICATION_CREDENTIALS = present;
		assert.strictEqual(search.hasAdc(), true);
	} finally {
		if (saved === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
		else process.env.GOOGLE_APPLICATION_CREDENTIALS = saved;
		for (const [key, value] of Object.entries(savedCloud)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test('get_documentation tool schema exposes optional framework property and rich doc description', async () => {
	const server = new Server(
		{ name: 'apple-docs-test', version: '0.0.0' },
		{ capabilities: { tools: {} } },
	);
	registerTools(server, {
		client: {},
		state: new ServerState(),
	});

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '0.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const listed = await client.listTools();
		const getDocTool = listed.tools.find((t) => t.name === 'get_documentation');
		assert.ok(getDocTool, 'get_documentation tool must be registered');
		assert.ok(
			getDocTool.description.includes('Swift syntax declarations'),
			'description must highlight rich declarations',
		);
		assert.ok(
			getDocTool.inputSchema.properties.framework,
			'inputSchema must include framework property',
		);
		assert.strictEqual(
			getDocTool.inputSchema.properties.framework.type,
			'string',
		);
	} finally {
		await client.close();
		await server.close();
	}
});

test('semantic_search tool schema is registered and accepts query and framework', async () => {
	const server = new Server(
		{ name: 'apple-docs-test', version: '0.0.0' },
		{ capabilities: { tools: {} } },
	);
	registerTools(server, {
		client: {},
		state: new ServerState(),
	});

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '0.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const listed = await client.listTools();
		const semanticTool = listed.tools.find((t) => t.name === 'semantic_search');
		assert.ok(semanticTool, 'semantic_search tool must be registered');
		assert.ok(
			semanticTool.description.includes('Gemini'),
			'description must mention Gemini hybrid embeddings',
		);
		assert.ok(
			semanticTool.inputSchema.properties.query,
			'inputSchema must include query property',
		);
		assert.ok(
			semanticTool.inputSchema.properties.framework,
			'inputSchema must include framework property',
		);
	} finally {
		await client.close();
		await server.close();
	}
});

test('tool schemas contract: choose_technology is optional, search_symbols is lexical, index_info registered', async () => {
	const server = new Server(
		{ name: 'apple-docs-test', version: '0.0.0' },
		{ capabilities: { tools: {} } },
	);
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/button',
		framework: 'SwiftUI',
		title: 'Button',
		kind: 'struct',
		abstract: 'A button.',
		path: '/documentation/swiftui/button',
		platforms: ['iOS'],
	});

	let receivedOptions = null;
	const mockSearchEngine = {
		search: async (query, opts) => {
			receivedOptions = opts;
			return [];
		},
	};

	registerTools(server, {
		client: {},
		state: new ServerState(),
		db,
		searchEngine: mockSearchEngine,
	});

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '0.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const listed = await client.listTools();
		const chooseTool = listed.tools.find((t) => t.name === 'choose_technology');
		assert.ok(chooseTool, 'choose_technology tool must be registered');
		assert.ok(
			chooseTool.description.toLowerCase().includes('optional'),
			'choose_technology description must contain "optional"',
		);
		assert.ok(
			chooseTool.description.includes('search_symbols') &&
				chooseTool.description.includes('semantic_search') &&
				chooseTool.description.includes('get_documentation'),
			'choose_technology description must provide examples of passing framework',
		);

		const searchTool = listed.tools.find((t) => t.name === 'search_symbols');
		assert.ok(searchTool, 'search_symbols tool must be registered');
		assert.ok(
			searchTool.description.includes('Lexical') &&
				searchTool.description.includes('does not call Gemini'),
			'search_symbols description must specify pure lexical search without Gemini',
		);

		const indexInfoTool = listed.tools.find((t) => t.name === 'index_info');
		assert.ok(indexInfoTool, 'index_info tool must be registered');

		// Execute search_symbols and verify lexicalOnly: true is passed without any Gemini credentials
		await client.callTool({
			name: 'search_symbols',
			arguments: { query: 'Button', framework: 'SwiftUI' },
		});
		assert.ok(receivedOptions, 'searchEngine.search must be called');
		assert.strictEqual(receivedOptions.lexicalOnly, true);

		// Execute index_info and verify output
		const infoRes = await client.callTool({
			name: 'index_info',
			arguments: {},
		});
		assert.strictEqual(infoRes.isError, undefined);
		assert.ok(infoRes.content[0].text.includes('Indexed Symbols: 1'));
	} finally {
		db.close();
		await client.close();
		await server.close();
	}
});
