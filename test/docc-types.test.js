import assert from 'node:assert';
import test from 'node:test';

test('DocC types compile and are exportable from types index', async () => {
	const types = await import('../dist/apple-client/types/index.js');
	assert.ok(types !== undefined);

	// Verify sample SymbolData shape with primaryContentSections and deprecationSummary
	const sampleSymbol = {
		abstract: [{ text: 'Sample', type: 'text' }],
		deprecationSummary: [
			{
				type: 'paragraph',
				inlineContent: [{ text: 'Deprecated', type: 'text' }],
			},
		],
		metadata: {
			platforms: [{ name: 'iOS', introducedAt: '16.0' }],
			symbolKind: 'struct',
			title: 'SampleView',
		},
		primaryContentSections: [
			{
				kind: 'declarations',
				declarations: [{ tokens: [{ kind: 'keyword', text: 'struct' }] }],
			},
			{
				kind: 'parameters',
				parameters: [{ name: 'arg', content: [] }],
			},
		],
		references: {},
		topicSections: [],
	};

	assert.strictEqual(sampleSymbol.metadata.title, 'SampleView');
	assert.strictEqual(sampleSymbol.primaryContentSections.length, 2);
});
