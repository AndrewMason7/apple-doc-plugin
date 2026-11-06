import assert from 'node:assert';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import { ServerState } from '../../dist/server/state.js';
import { registerResources } from '../../dist/server/resources.js';

test('MCP Resources: lists static resources and templates', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A type that represents part of the user interface of an app.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});

	const server = new Server(
		{ name: 'apple-docs-resource-test', version: '1.0.0' },
		{ capabilities: { resources: {} } },
	);
	registerResources(server, {
		client: {},
		state: new ServerState(),
		db,
	});

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const resourcesList = await client.listResources();
		assert.ok(Array.isArray(resourcesList.resources));
		assert.ok(
			resourcesList.resources.some((r) => r.uri === 'apple-docs://frameworks'),
		);
		assert.ok(
			resourcesList.resources.some(
				(r) => r.uri === 'apple-docs://symbols/SwiftUI',
			),
		);

		const templatesList = await client.listResourceTemplates();
		assert.ok(Array.isArray(templatesList.resourceTemplates));
		assert.ok(
			templatesList.resourceTemplates.some(
				(t) => t.uriTemplate === 'apple-docs://symbols/{framework}',
			),
		);
	} finally {
		db.close();
		await client.close();
		await server.close();
	}
});

test('MCP Resources: reads apple-docs://frameworks resource content', async () => {
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
		{ name: 'apple-docs-resource-test', version: '1.0.0' },
		{ capabilities: { resources: {} } },
	);
	registerResources(server, {
		client: {},
		state: new ServerState(),
		db,
	});

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const readRes = await client.readResource({
			uri: 'apple-docs://frameworks',
		});
		assert.strictEqual(readRes.contents.length, 1);
		assert.strictEqual(readRes.contents[0].mimeType, 'application/json');

		const data = JSON.parse(readRes.contents[0].text);
		assert.strictEqual(data.uri, 'apple-docs://frameworks');
		assert.ok(data.totalFrameworks >= 1);
		const swiftui = data.frameworks.find((f) => f.name === 'SwiftUI');
		assert.ok(swiftui);
		assert.strictEqual(swiftui.symbolCount, 1);
		assert.strictEqual(swiftui.primaryTypeCount, 1);
	} finally {
		db.close();
		await client.close();
		await server.close();
	}
});

test('MCP Resources: reads apple-docs://symbols/{framework} resource content', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A view protocol.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/swiftui/vstack',
		framework: 'SwiftUI',
		title: 'VStack',
		kind: 'struct',
		abstract: 'A vertical stack.',
		path: '/documentation/swiftui/vstack',
		platforms: ['iOS'],
		isPrimaryType: true,
	});

	const server = new Server(
		{ name: 'apple-docs-resource-test', version: '1.0.0' },
		{ capabilities: { resources: {} } },
	);
	registerResources(server, {
		client: {},
		state: new ServerState(),
		db,
	});

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const readRes = await client.readResource({
			uri: 'apple-docs://symbols/SwiftUI',
		});
		assert.strictEqual(readRes.contents.length, 1);
		const data = JSON.parse(readRes.contents[0].text);
		assert.strictEqual(data.framework, 'SwiftUI');
		assert.strictEqual(data.count, 2);
		assert.ok(data.symbols.some((s) => s.title === 'View'));
		assert.ok(data.symbols.some((s) => s.title === 'VStack'));
	} finally {
		db.close();
		await client.close();
		await server.close();
	}
});

test('MCP Resources: throws on unknown resource URI', async () => {
	const server = new Server(
		{ name: 'apple-docs-resource-test', version: '1.0.0' },
		{ capabilities: { resources: {} } },
	);
	registerResources(server, {
		client: {},
		state: new ServerState(),
	});

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		await assert.rejects(
			async () => {
				await client.readResource({ uri: 'apple-docs://unknown-resource' });
			},
			{ message: /Unknown resource URI/ },
		);

		await assert.rejects(
			async () => {
				await client.readResource({
					uri: 'apple-docs://symbols/NotAFrameworkXYZ',
				});
			},
			{ message: /is not recognized as an Apple framework/ },
		);
	} finally {
		await client.close();
		await server.close();
	}
});

test('MCP Resources: apple-docs://frameworks lists all 21 core frameworks', async () => {
	const server = new Server(
		{ name: 'apple-docs-resource-test', version: '1.0.0' },
		{ capabilities: { resources: {} } },
	);
	registerResources(server, {
		client: {},
		state: new ServerState(),
	});

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const readRes = await client.readResource({
			uri: 'apple-docs://frameworks',
		});
		const data = JSON.parse(readRes.contents[0].text);
		assert.strictEqual(data.totalFrameworks, 21);
		const names = data.frameworks.map((f) => f.name);
		assert.ok(names.includes('SwiftUI'));
		assert.ok(names.includes('StoreKit'));
		assert.ok(names.includes('AuthenticationServices'));
		assert.ok(names.includes('Security'));
		assert.ok(names.includes('WebKit'));
	} finally {
		await client.close();
		await server.close();
	}
});
