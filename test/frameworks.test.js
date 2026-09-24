import assert from 'node:assert';
import test from 'node:test';
import { CORE_FRAMEWORKS } from '../dist/server/db/frameworks.js';
import { buildDiscoverHandler } from '../dist/server/handlers/discover.js';
import { ServerState } from '../dist/server/state.js';

test('CORE_FRAMEWORKS is the single source of truth for indexed frameworks', () => {
	assert.ok(Array.isArray(CORE_FRAMEWORKS));
	assert.strictEqual(CORE_FRAMEWORKS.length, 8);
	const expected = [
		'SwiftUI',
		'UIKit',
		'Foundation',
		'SwiftData',
		'Combine',
		'AppKit',
		'Observation',
		'CoreLocation',
	];
	assert.deepStrictEqual([...CORE_FRAMEWORKS], expected);
});

test('discover_technologies lists the indexed frameworks even when offline', async () => {
	const offlineClient = {
		getTechnologies: async () => {
			throw new Error('network down');
		},
		extractText: (abstract) => abstract?.map((a) => a.text).join('') || '',
	};
	const state = new ServerState();
	const handler = buildDiscoverHandler({ client: offlineClient, state });

	const res = await handler({});
	const text = res.content[0].text;
	assert.ok(text.includes('Total indexed frameworks'));
	assert.ok(text.includes('8'));
	assert.ok(text.includes('### SwiftUI'));
	assert.ok(text.includes('### UIKit'));
	assert.ok(text.includes('### Foundation'));
	assert.ok(text.includes('optional'));
});
