import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { indexFrameworkData } from '../dist/server/services/indexer.js';

test('indexFrameworkData correctly extracts symbols and abstracts', () => {
	const db = new AppleDocsDB(':memory:');
	const mockDocC = {
		metadata: { title: 'SwiftUI' },
		references: {
			'doc://com.apple.documentation/documentation/swiftui/view': {
				title: 'View',
				kind: 'symbol',
				symbolKind: 'protocol',
				url: '/documentation/swiftui/view',
				abstract: [
					{
						type: 'text',
						text: 'A type that represents part of the user interface.',
					},
				],
				platforms: [{ name: 'iOS' }],
			},
			'doc://com.apple.documentation/documentation/swiftui/button': {
				title: 'Button',
				kind: 'symbol',
				symbolKind: 'struct',
				url: '/documentation/swiftui/button',
				abstract: [
					{ type: 'text', text: 'A control that initiates an action.' },
				],
				platforms: [{ name: 'iOS' }, { name: 'macOS' }],
			},
		},
	};

	const count = indexFrameworkData(db, 'SwiftUI', mockDocC);
	assert.strictEqual(count, 2);

	const results = db.queryFTS('View');
	assert.strictEqual(results.length, 1);
	assert.strictEqual(results[0].title, 'View');
	assert.strictEqual(
		results[0].abstract,
		'A type that represents part of the user interface.',
	);
	assert.strictEqual(results[0].kind, 'protocol');
	assert.strictEqual(results[0].isPrimaryType, true);

	db.close();
});
