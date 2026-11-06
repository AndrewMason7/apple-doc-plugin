import assert from 'node:assert';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerPrompts } from '../dist/server/prompts.js';

test('MCP Prompts: lists available prompt workflows', async () => {
	const server = new Server(
		{ name: 'apple-docs-prompt-test', version: '1.0.0' },
		{ capabilities: { prompts: {} } },
	);
	registerPrompts(server);

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const promptsList = await client.listPrompts();
		assert.ok(Array.isArray(promptsList.prompts));
		const names = promptsList.prompts.map((p) => p.name);
		assert.ok(names.includes('modernize-navigation'));
		assert.ok(names.includes('scaffold-swiftdata'));
		assert.ok(names.includes('audit-deprecation'));
	} finally {
		await client.close();
		await server.close();
	}
});

test('MCP Prompts: executes modernize-navigation prompt', async () => {
	const server = new Server(
		{ name: 'apple-docs-prompt-test', version: '1.0.0' },
		{ capabilities: { prompts: {} } },
	);
	registerPrompts(server);

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const prompt = await client.getPrompt({
			name: 'modernize-navigation',
			arguments: {
				code: 'NavigationView { NavigationLink("Detail", destination: DetailView()) }',
			},
		});

		assert.ok(prompt.description);
		assert.strictEqual(prompt.messages.length, 1);
		assert.strictEqual(prompt.messages[0].role, 'user');
		assert.ok(prompt.messages[0].content.text.includes('NavigationStack'));
		assert.ok(
			prompt.messages[0].content.text.includes(
				'NavigationView { NavigationLink("Detail", destination: DetailView()) }',
			),
		);
	} finally {
		await client.close();
		await server.close();
	}
});

test('MCP Prompts: executes scaffold-swiftdata prompt', async () => {
	const server = new Server(
		{ name: 'apple-docs-prompt-test', version: '1.0.0' },
		{ capabilities: { prompts: {} } },
	);
	registerPrompts(server);

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const prompt = await client.getPrompt({
			name: 'scaffold-swiftdata',
			arguments: {
				entities: 'User entity with id, name, and one-to-many Orders',
			},
		});

		assert.ok(prompt.messages[0].content.text.includes('@Model'));
		assert.ok(prompt.messages[0].content.text.includes('User entity'));
	} finally {
		await client.close();
		await server.close();
	}
});

test('MCP Prompts: executes audit-deprecation prompt', async () => {
	const server = new Server(
		{ name: 'apple-docs-prompt-test', version: '1.0.0' },
		{ capabilities: { prompts: {} } },
	);
	registerPrompts(server);

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		const prompt = await client.getPrompt({
			name: 'audit-deprecation',
			arguments: {
				code: 'class Model: ObservableObject { @Published var count = 0 }',
			},
		});

		assert.ok(prompt.messages[0].content.text.includes('ObservableObject'));
		assert.ok(prompt.messages[0].content.text.includes('@Observable'));
	} finally {
		await client.close();
		await server.close();
	}
});

test('MCP Prompts: rejects missing required arguments or unknown prompt', async () => {
	const server = new Server(
		{ name: 'apple-docs-prompt-test', version: '1.0.0' },
		{ capabilities: { prompts: {} } },
	);
	registerPrompts(server);

	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	try {
		await assert.rejects(
			async () => {
				await client.getPrompt({
					name: 'modernize-navigation',
					arguments: {},
				});
			},
			{ message: /Missing required prompt argument: "code"/ },
		);

		await assert.rejects(
			async () => {
				await client.getPrompt({
					name: 'non-existent-prompt',
					arguments: {},
				});
			},
			{ message: /Unknown prompt/ },
		);
	} finally {
		await client.close();
		await server.close();
	}
});
