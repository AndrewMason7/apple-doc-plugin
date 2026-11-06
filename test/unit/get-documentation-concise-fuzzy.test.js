import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import { buildGetDocumentationHandler } from '../../dist/server/handlers/get-documentation.js';
import {
	levenshteinDistance,
	similarityRatio,
} from '../../dist/server/services/levenshtein.js';

test('Levenshtein distance & similarity ratio computation', () => {
	assert.strictEqual(levenshteinDistance('', ''), 0);
	assert.strictEqual(levenshteinDistance('a', ''), 1);
	assert.strictEqual(levenshteinDistance('VStack', 'VStack'), 0);
	assert.strictEqual(levenshteinDistance('vstack', 'VStack'), 0);
	assert.strictEqual(
		levenshteinDistance('NavgationStack', 'NavigationStack'),
		1,
	);
	assert.strictEqual(levenshteinDistance('Collor', 'Color'), 1);

	assert.strictEqual(similarityRatio('VStack', 'VStack'), 1.0);
	assert.ok(similarityRatio('NavgationStack', 'NavigationStack') > 0.9);
});

test('get_documentation: provides fuzzy typo suggestions when symbol is misspelled', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/navigationstack',
		framework: 'SwiftUI',
		title: 'NavigationStack',
		kind: 'struct',
		abstract:
			'A view that displays a root view and enables you to present additional views over the root view.',
		path: '/documentation/swiftui/navigationstack',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});
	db.insertSymbol({
		id: 'documentation/swiftui/navigationsplitview',
		framework: 'SwiftUI',
		title: 'NavigationSplitView',
		kind: 'struct',
		abstract: 'A view that presents views in two or three columns.',
		path: '/documentation/swiftui/navigationsplitview',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});

	const dummyClient = {
		extractText: (abstract) => abstract?.map((a) => a.text).join('') || '',
		formatPlatforms: () => 'iOS',
		getFramework: async () => ({}),
	};

	const handler = buildGetDocumentationHandler({
		client: dummyClient,
		db,
	});

	// Typo query: "NavgationStack" (missing 'i')
	const result = await handler({
		path: 'NavgationStack',
		framework: 'SwiftUI',
	});

	assert.strictEqual(result.isError, true);
	const text = result.content[0].text;
	assert.ok(text.includes('UNRESOLVED:'));
	assert.ok(text.includes('Did you mean?'));
	assert.ok(text.includes('**NavigationStack** (SwiftUI struct)'));
	assert.ok(
		text.includes(
			'get_documentation({ "path": "NavigationStack", "framework": "SwiftUI" })',
		),
	);

	db.close();
});

test('get_documentation: concise: true omits Discussion and TopicSections', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/navigationstack',
		framework: 'SwiftUI',
		title: 'NavigationStack',
		kind: 'struct',
		abstract: 'A view presenting a stack of views.',
		path: '/documentation/swiftui/navigationstack',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});

	const mockDocCData = {
		metadata: {
			title: 'NavigationStack',
			symbolKind: 'struct',
			platforms: [{ name: 'iOS', introducedAt: '16.0' }],
		},
		abstract: [{ type: 'text', text: 'A view presenting a stack of views.' }],
		primaryContentSections: [
			{
				kind: 'declarations',
				declarations: [
					{
						tokens: [
							{ kind: 'keyword', text: 'struct' },
							{ kind: 'text', text: ' NavigationStack' },
						],
						languages: ['swift'],
					},
				],
			},
			{
				kind: 'parameters',
				parameters: [
					{
						name: 'path',
						content: [
							{
								type: 'paragraph',
								inlineContent: [{ type: 'text', text: 'The navigation path.' }],
							},
						],
					},
				],
			},
			{
				kind: 'content',
				content: [
					{
						type: 'paragraph',
						inlineContent: [
							{ type: 'text', text: 'Verbose detailed discussion here.' },
						],
					},
				],
			},
		],
		topicSections: [
			{
				title: 'Initializers',
				identifiers: [
					'doc://com.apple.documentation/documentation/SwiftUI/NavigationStack/init()',
				],
			},
		],
		references: {
			'doc://com.apple.documentation/documentation/SwiftUI/NavigationStack/init()':
				{
					title: 'init()',
					abstract: [
						{ type: 'text', text: 'Creates an empty navigation stack.' },
					],
				},
		},
	};

	const mockClient = {
		extractText: (abstract) => abstract?.map((a) => a.text).join('') || '',
		formatPlatforms: () => 'iOS (16.0+)',
		getFramework: async () => ({}),
		getSymbol: async () => mockDocCData,
	};

	const handler = buildGetDocumentationHandler({
		client: mockClient,
		db,
	});

	// 1. Regular verbose call: should include Discussion and API Reference
	const verboseRes = await handler({
		path: 'NavigationStack',
		framework: 'SwiftUI',
		concise: false,
	});
	const verboseText = verboseRes.content[0].text;
	assert.ok(verboseText.includes('## Discussion'));
	assert.ok(verboseText.includes('Verbose detailed discussion here.'));
	assert.ok(verboseText.includes('## API Reference'));

	// 2. Concise call: must strip Discussion and TopicSections
	const conciseRes = await handler({
		path: 'NavigationStack',
		framework: 'SwiftUI',
		concise: true,
	});
	const conciseText = conciseRes.content[0].text;
	assert.ok(conciseText.includes('# NavigationStack'));
	assert.ok(conciseText.includes('## Declaration'));
	assert.ok(conciseText.includes('struct NavigationStack'));
	assert.ok(conciseText.includes('### Parameters'));
	assert.ok(conciseText.includes('- `path`: The navigation path.'));
	assert.ok(conciseText.includes('## Overview'));
	assert.strictEqual(conciseText.includes('## Discussion'), false);
	assert.strictEqual(
		conciseText.includes('Verbose detailed discussion here.'),
		false,
	);
	// 3. String "true" concise call: must also strip Discussion and TopicSections
	const stringConciseRes = await handler({
		path: 'NavigationStack',
		framework: 'SwiftUI',
		concise: 'true',
	});
	const stringConciseText = stringConciseRes.content[0].text;
	assert.strictEqual(stringConciseText.includes('## Discussion'), false);

	// 4. String "false" concise call: must preserve Discussion
	const stringVerboseRes = await handler({
		path: 'NavigationStack',
		framework: 'SwiftUI',
		concise: 'false',
	});
	const stringVerboseText = stringVerboseRes.content[0].text;
	assert.ok(stringVerboseText.includes('## Discussion'));

	db.close();
});

test('Levenshtein: character transpositions count as distance 1 (Damerau-Levenshtein)', () => {
	assert.strictEqual(levenshteinDistance('Viwe', 'View'), 1);
	assert.strictEqual(
		levenshteinDistance('NvaigationStack', 'NavigationStack'),
		1,
	);
	assert.strictEqual(
		levenshteinDistance('NavigatonStack', 'NavigationStack'),
		1,
	);
});

test('get_documentation: fuzzy matching infers framework from query path', async () => {
	const db = new AppleDocsDB(':memory:');
	db.insertSymbol({
		id: 'documentation/swiftui/view',
		framework: 'SwiftUI',
		title: 'View',
		kind: 'protocol',
		abstract: 'A view protocol.',
		path: '/documentation/swiftui/view',
		platforms: ['iOS', 'macOS'],
		isPrimaryType: true,
	});

	const dummyClient = {
		extractText: (abstract) => abstract?.map((a) => a.text).join('') || '',
		formatPlatforms: () => 'iOS',
		getFramework: async () => ({}),
	};

	const handler = buildGetDocumentationHandler({
		client: dummyClient,
		db,
	});

	// Typo with transposed letters "Viwe" without framework parameter
	const res = await handler({ path: 'Viwe' });
	assert.strictEqual(res.isError, true);
	const text = res.content[0].text;
	assert.ok(text.includes('Did you mean?'));
	assert.ok(text.includes('**View** (SwiftUI protocol)'));

	// Typo embedded in path: "SwiftUI/Viwe"
	const pathRes = await handler({ path: 'SwiftUI/Viwe' });
	assert.strictEqual(pathRes.isError, true);
	const pathText = pathRes.content[0].text;
	assert.ok(pathText.includes('Did you mean?'));
	assert.ok(pathText.includes('**View** (SwiftUI protocol)'));

	db.close();
});
