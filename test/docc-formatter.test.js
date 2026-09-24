import assert from 'node:assert';
import test from 'node:test';
import {
	formatDeclaration,
	formatDeprecation,
	formatParameters,
	formatDiscussion,
	formatInlineContent,
	formatContentNodes,
} from '../dist/apple-client/docc-formatter.js';

test('formatDeclaration formats tokens into a swift code block', () => {
	const sections = [
		{
			kind: 'declarations',
			declarations: [
				{
					languages: ['swift'],
					tokens: [
						{ kind: 'keyword', text: 'struct' },
						{ kind: 'text', text: ' ' },
						{ kind: 'identifier', text: 'NavigationStack' },
						{ kind: 'text', text: '<Data, Root>' },
					],
				},
			],
		},
	];
	const result = formatDeclaration(sections);
	assert.strictEqual(
		result,
		'```swift\nstruct NavigationStack<Data, Root>\n```',
	);
});

test('formatDeclaration returns undefined when declarations section is empty or missing', () => {
	assert.strictEqual(formatDeclaration(undefined), undefined);
	assert.strictEqual(formatDeclaration([]), undefined);
	assert.strictEqual(
		formatDeclaration([{ kind: 'declarations', declarations: [] }]),
		undefined,
	);
});

test('formatDeprecation renders GitHub warning alert with inline content', () => {
	const summary = [
		{
			type: 'paragraph',
			inlineContent: [
				{ type: 'text', text: 'Use ' },
				{
					type: 'reference',
					identifier:
						'doc://com.apple.SwiftUI/documentation/SwiftUI/NavigationStack',
				},
				{ type: 'text', text: ' instead.' },
			],
		},
	];
	const result = formatDeprecation(summary);
	assert.ok(result.includes('> [!WARNING]'));
	assert.ok(result.includes('Use `NavigationStack` instead.'));
});

test('formatDeprecation returns undefined when summary is empty or undefined', () => {
	assert.strictEqual(formatDeprecation(undefined), undefined);
	assert.strictEqual(formatDeprecation([]), undefined);
});

test('formatParameters renders parameters list', () => {
	const sections = [
		{
			kind: 'parameters',
			parameters: [
				{
					name: 'value',
					content: [
						{
							type: 'paragraph',
							inlineContent: [
								{ type: 'text', text: 'An optional value.' },
							],
						},
					],
				},
			],
		},
	];
	const result = formatParameters(sections);
	assert.ok(result.includes('### Parameters'));
	assert.ok(result.includes('- `value`: An optional value.'));
});

test('formatDiscussion converts code listings, headings, and paragraphs', () => {
	const sections = [
		{
			kind: 'content',
			content: [
				{
					type: 'heading',
					level: 3,
					text: 'Overview Details',
				},
				{
					type: 'paragraph',
					inlineContent: [{ type: 'text', text: 'Sample description.' }],
				},
				{
					type: 'codeListing',
					syntax: 'swift',
					code: ['let x = 10', 'print(x)'],
				},
				{
					type: 'aside',
					style: 'important',
					content: [
						{
							type: 'paragraph',
							inlineContent: [
								{ type: 'text', text: 'Critical caution note.' },
							],
						},
					],
				},
			],
		},
	];
	const result = formatDiscussion(sections);
	assert.ok(result.includes('### Overview Details'));
	assert.ok(result.includes('Sample description.'));
	assert.ok(result.includes('```swift\nlet x = 10\nprint(x)\n```'));
	assert.ok(result.includes('> [!IMPORTANT]'));
	assert.ok(result.includes('> Critical caution note.'));
});

test('formatInlineContent handles bold, italic, codeVoice, and links', () => {
	const inline = [
		{ type: 'text', text: 'Here is ' },
		{ type: 'codeVoice', code: 'nil' },
		{ type: 'text', text: ' and ' },
		{
			type: 'strong',
			inlineContent: [{ type: 'text', text: 'important' }],
		},
		{ type: 'text', text: ' with ' },
		{
			type: 'link',
			title: 'Apple',
			destination: 'https://apple.com',
		},
	];
	const result = formatInlineContent(inline);
	assert.strictEqual(
		result,
		'Here is `nil` and **important** with [Apple](https://apple.com)',
	);
});
