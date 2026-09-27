import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server/app.js';
import { buildChooseTechnologyHandler } from '../dist/server/handlers/choose-technology.js';
import { buildDiscoverHandler } from '../dist/server/handlers/discover.js';
import { ServerState } from '../dist/server/state.js';

test('Handlers: choose_technology returns isError: true when technology is unknown', async () => {
	const server = createServer();
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '1.0.0' });

	await server.connect(serverTransport);
	await client.connect(clientTransport);

	const response = await client.callTool({
		name: 'choose_technology',
		arguments: { name: 'NonExistentTechnology999' },
	});

	assert.equal(response.isError, true);
	assert.ok(response.content[0].text.includes('Technology Not Found'));

	await client.close();
	await server.close();
});

test('Handlers: discover_technologies clamps NaN and negative numbers for pagination', async () => {
	const mockClient = {
		getTechnologies: async () => ({}),
		extractText: () => '',
	};
	const state = new ServerState();
	const handler = buildDiscoverHandler({
		client: mockClient,
		state,
	});

	const response = await handler({
		page: -5,
		pageSize: -10,
	});

	assert.notEqual(response.content[0].text, '');
	assert.ok(response.content[0].text.includes('Technologies'));
});
