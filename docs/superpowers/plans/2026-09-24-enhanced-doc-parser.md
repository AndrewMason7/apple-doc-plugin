# Enhanced DocC AST Parser & Rich Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `get_documentation` to parse and render rich Apple DocC AST—including syntax-highlighted Swift code declarations, parameter lists, deprecation warning alerts with modern replacements, and official code examples—while adding stateless `framework?: string` support.

**Architecture:** Pure, decoupled DocC AST formatter service (`src/apple-client/docc-formatter.ts`) following Separation of Concerns (SoC), integrated cleanly into `get-documentation.ts` and exposed statelessly through MCP tools (`src/server/tools.ts`).

**Tech Stack:** TypeScript (ESNext/NodeNext), Node.js built-in test runner (`node:test`, `node:assert`), `@modelcontextprotocol/sdk`.

**Spec:** [`docs/superpowers/specs/2026-09-24-enhanced-doc-parser-design.md`](file:///Users/andrew/Documents/GitHub/apple-doc-plugin/docs/superpowers/specs/2026-09-24-enhanced-doc-parser-design.md)

## Global Constraints

- Must strictly adhere to Separation of Concerns: formatter functions must be pure, synchronous/idempotent string transforms with zero network or filesystem I/O.
- Must preserve 100% backward compatibility: existing calls without `framework` or with cached SQLite fallbacks must continue working seamlessly.
- All existing 60/60 unit/integration tests must continue passing.
- TypeScript compiler (`npm run build`) must compile cleanly with zero errors or implicit `any` violations.
- Code style: Prettier formatted, 2-space indentation, tabs matching existing repo standard.

## Review Focus

1. **Empty/Malformed Primary Content Sections**: DocC payloads that have empty `declarations`, missing `tokens`, or undefined `content` must not throw uncaught TypeError exceptions.
2. **Recursive Inline Content in Deprecations & Paragraphs**: Formatting nested inline tokens (`codeVoice`, `reference`, `emphasis`, `strong`) must handle strings, objects, and empty arrays without leaking `[object Object]` into markdown.
3. **Multi-line Swift Declarations**: Generic constraints (`where Root : View`), attributes (`@MainActor`, `nonisolated`), and multiple arguments must maintain readable whitespace and syntax fences.
4. **Stateless `framework` Argument**: Passing `framework: "SwiftUI"` and `path: "NavigationStack"` to `get_documentation` must resolve properly without requiring prior `choose_technology` invocation.
5. **Offline Fallback Preservation**: When Apple CDN fails or network is disconnected, local SQLite metadata must be returned without raising an unhandled rejection.

---

### Task 1: DocC AST Type Definitions

**Files:**
- Modify: `src/apple-client/types/index.ts`
- Test: `test/docc-types.test.js`

**Interfaces:**
- Consumes: Existing `SymbolData` in `src/apple-client/types/index.ts`
- Produces: `DocCToken`, `DocCDeclaration`, `DocCParameter`, `DocCContentNode`, `DocCInlineContent`, `DocCSection`, updated `SymbolData` with typed `primaryContentSections` and `deprecationSummary`.

- [ ] **Step 1: Write the failing test**

Create `test/docc-types.test.js`:
```javascript
import assert from 'node:assert';
import test from 'node:test';

test('DocC types compile and are exportable from types index', async () => {
	// Dynamically import compiled types index
	const types = await import('../dist/apple-client/types/index.js');
	assert.ok(types !== undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/docc-types.test.js`
Expected: FAIL (file or dist not yet updated with new test)

- [ ] **Step 3: Write minimal implementation**

Update `src/apple-client/types/index.ts` to add detailed DocC AST definitions:
```typescript
export type DocCToken = {
	kind: 'keyword' | 'attribute' | 'identifier' | 'text' | 'genericParameter' | 'typeIdentifier' | 'externalParam' | 'internalParam' | string;
	text: string;
};

export type DocCDeclaration = {
	languages?: string[];
	platforms?: string[];
	tokens: DocCToken[];
};

export type DocCInlineContent = {
	type: 'text' | 'codeVoice' | 'reference' | 'emphasis' | 'strong' | 'link' | string;
	text?: string;
	code?: string;
	identifier?: string;
	title?: string;
	destination?: string;
	inlineContent?: DocCInlineContent[];
};

export type DocCContentNode = {
	type: 'paragraph' | 'heading' | 'codeListing' | 'unorderedList' | 'orderedList' | 'aside' | string;
	level?: number;
	text?: string;
	syntax?: string;
	code?: string[];
	style?: string;
	name?: string;
	inlineContent?: DocCInlineContent[];
	content?: DocCContentNode[];
	items?: Array<{ content: DocCContentNode[] }>;
};

export type DocCParameter = {
	name: string;
	content: DocCContentNode[];
};

export type DocCPrimaryContentSection = {
	kind: 'declarations' | 'parameters' | 'content' | 'mentions' | string;
	title?: string;
	declarations?: DocCDeclaration[];
	parameters?: DocCParameter[];
	content?: DocCContentNode[];
};

export type SymbolData = {
	abstract: Array<{ text: string; type: string }>;
	deprecationSummary?: DocCContentNode[];
	metadata: {
		platforms: PlatformInfo[];
		symbolKind: string;
		title: string;
	};
	primaryContentSections?: DocCPrimaryContentSection[];
	references: Record<string, ReferenceData>;
	topicSections: TopicSection[];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/docc-types.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/apple-client/types/index.ts test/docc-types.test.js
git commit -m "feat(types): add comprehensive DocC AST and declaration types"
```

---

### Task 2: Pure DocC AST Formatter Service

**Files:**
- Create: `src/apple-client/docc-formatter.ts`
- Test: `test/docc-formatter.test.js`

**Interfaces:**
- Consumes: `DocCPrimaryContentSection`, `DocCContentNode`, `DocCInlineContent`, `DocCDeclaration`, `SymbolData` from `src/apple-client/types/index.ts`
- Produces:
  - `formatDeclaration(sections?: DocCPrimaryContentSection[]): string | undefined`
  - `formatDeprecation(summary?: DocCContentNode[]): string | undefined`
  - `formatParameters(sections?: DocCPrimaryContentSection[]): string | undefined`
  - `formatDiscussion(sections?: DocCPrimaryContentSection[]): string | undefined`
  - `formatInlineContent(nodes?: DocCInlineContent[]): string`
  - `formatContentNodes(nodes?: DocCContentNode[]): string`

- [ ] **Step 1: Write the failing test**

Create `test/docc-formatter.test.js`:
```javascript
import assert from 'node:assert';
import test from 'node:test';
import {
	formatDeclaration,
	formatDeprecation,
	formatParameters,
	formatDiscussion,
	formatInlineContent,
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

test('formatDeprecation renders GitHub warning alert with inline content', () => {
	const summary = [
		{
			type: 'paragraph',
			inlineContent: [
				{ type: 'text', text: 'Use ' },
				{
					type: 'reference',
					identifier: 'doc://com.apple.SwiftUI/documentation/SwiftUI/NavigationStack',
				},
				{ type: 'text', text: ' instead.' },
			],
		},
	];
	const result = formatDeprecation(summary);
	assert.ok(result.includes('> [!WARNING]'));
	assert.ok(result.includes('Use `NavigationStack` instead.'));
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

test('formatDiscussion converts code listings and paragraphs', () => {
	const sections = [
		{
			kind: 'content',
			content: [
				{
					type: 'paragraph',
					inlineContent: [{ type: 'text', text: 'Sample description.' }],
				},
				{
					type: 'codeListing',
					syntax: 'swift',
					code: ['let x = 10', 'print(x)'],
				},
			],
		},
	];
	const result = formatDiscussion(sections);
	assert.ok(result.includes('Sample description.'));
	assert.ok(result.includes('```swift\nlet x = 10\nprint(x)\n```'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/docc-formatter.test.js`
Expected: FAIL (`Cannot find module '../dist/apple-client/docc-formatter.js'`)

- [ ] **Step 3: Write minimal implementation**

Create `src/apple-client/docc-formatter.ts`:
```typescript
import type {
	DocCContentNode,
	DocCDeclaration,
	DocCInlineContent,
	DocCParameter,
	DocCPrimaryContentSection,
} from './types/index.js';

export const formatInlineContent = (
	nodes?: DocCInlineContent[],
): string => {
	if (!nodes || !Array.isArray(nodes)) {
		return '';
	}

	return nodes
		.map((node) => {
			if (node.type === 'text') {
				return node.text ?? '';
			}
			if (node.type === 'codeVoice') {
				return `\`${node.code ?? ''}\``;
			}
			if (node.type === 'reference') {
				const title =
					node.title ||
					node.identifier?.split('/').pop()?.replace(/-/g, ' ') ||
					'reference';
				return `\`${title}\``;
			}
			if (node.type === 'emphasis') {
				return `*${formatInlineContent(node.inlineContent)}*`;
			}
			if (node.type === 'strong') {
				return `**${formatInlineContent(node.inlineContent)}**`;
			}
			if (node.type === 'link') {
				return `[${node.title || node.destination}](${node.destination})`;
			}
			if (node.inlineContent) {
				return formatInlineContent(node.inlineContent);
			}
			return node.text ?? '';
		})
		.join('');
};

export const formatContentNodes = (nodes?: DocCContentNode[]): string => {
	if (!nodes || !Array.isArray(nodes)) {
		return '';
	}

	const parts: string[] = [];

	for (const node of nodes) {
		if (node.type === 'paragraph') {
			const text = formatInlineContent(node.inlineContent).trim();
			if (text) {
				parts.push(text);
			}
		} else if (node.type === 'heading') {
			const level = Math.min(Math.max(node.level ?? 2, 1), 6);
			const hashes = '#'.repeat(level);
			parts.push(`\n${hashes} ${node.text || ''}\n`);
		} else if (node.type === 'codeListing') {
			const lang = node.syntax || 'swift';
			const code = Array.isArray(node.code) ? node.code.join('\n') : '';
			parts.push(`\`\`\`${lang}\n${code}\n\`\`\``);
		} else if (node.type === 'unorderedList' && Array.isArray(node.items)) {
			const listItems = node.items
				.map((item) => `- ${formatContentNodes(item.content).trim()}`)
				.join('\n');
			parts.push(listItems);
		} else if (node.type === 'aside') {
			const style = node.style?.toUpperCase() || 'NOTE';
			const content = formatContentNodes(node.content).trim();
			parts.push(`> [!${style}]\n> ${content.replace(/\n/g, '\n> ')}`);
		}
	}

	return parts.join('\n\n');
};

export const formatDeclaration = (
	sections?: DocCPrimaryContentSection[],
): string | undefined => {
	if (!sections) return undefined;
	const declSection = sections.find((s) => s.kind === 'declarations');
	if (!declSection || !Array.isArray(declSection.declarations)) return undefined;

	const firstDecl = declSection.declarations[0];
	if (!firstDecl || !Array.isArray(firstDecl.tokens) || firstDecl.tokens.length === 0) {
		return undefined;
	}

	const lang = firstDecl.languages?.[0] || 'swift';
	const rawCode = firstDecl.tokens.map((t) => t.text).join('').trim();
	if (!rawCode) return undefined;

	return `\`\`\`${lang}\n${rawCode}\n\`\`\``;
};

export const formatDeprecation = (
	summary?: DocCContentNode[],
): string | undefined => {
	if (!summary || !Array.isArray(summary) || summary.length === 0) {
		return undefined;
	}

	const content = formatContentNodes(summary).trim();
	if (!content) return undefined;

	return `> [!WARNING]\n> **Deprecated**: ${content.replace(/\n/g, '\n> ')}`;
};

export const formatParameters = (
	sections?: DocCPrimaryContentSection[],
): string | undefined => {
	if (!sections) return undefined;
	const paramsSection = sections.find((s) => s.kind === 'parameters');
	if (!paramsSection || !Array.isArray(paramsSection.parameters) || paramsSection.parameters.length === 0) {
		return undefined;
	}

	const items = paramsSection.parameters.map((param) => {
		const desc = formatContentNodes(param.content).trim();
		return `- \`${param.name}\`: ${desc}`;
	});

	return `### Parameters\n${items.join('\n')}`;
};

export const formatDiscussion = (
	sections?: DocCPrimaryContentSection[],
): string | undefined => {
	if (!sections) return undefined;
	const contentSections = sections.filter((s) => s.kind === 'content');
	if (!contentSections.length) return undefined;

	const textBlocks = contentSections
		.map((s) => formatContentNodes(s.content).trim())
		.filter(Boolean);

	if (!textBlocks.length) return undefined;
	return textBlocks.join('\n\n');
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/docc-formatter.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/apple-client/docc-formatter.ts test/docc-formatter.test.js
git commit -m "feat(formatter): implement pure DocC AST markdown formatter"
```

---

### Task 3: Handler Integration & Stateless Framework Support

**Files:**
- Modify: `src/server/handlers/get-documentation.ts`
- Modify: `src/server/services/symbol-resolution.ts`
- Test: `test/mcp-handlers.test.js`

**Interfaces:**
- Consumes: `formatDeclaration`, `formatDeprecation`, `formatParameters`, `formatDiscussion` from `src/apple-client/docc-formatter.ts`
- Produces: Enhanced `get_documentation` handler supporting `{ path: string; framework?: string }` with full Swift declarations, parameters, deprecation warnings, and discussion.

- [ ] **Step 1: Write the failing test**

Add to `test/mcp-handlers.test.js`:
```javascript
test('get_documentation formats declaration, parameters, and deprecation when present', async () => {
	const { buildGetDocumentationHandler } = await import('../dist/server/handlers/get-documentation.js');
	const mockClient = {
		formatPlatforms: () => 'iOS 16.0+, macOS 13.0+',
		extractText: (abstract) => 'Presents a stack of views.',
		getSymbol: async () => ({
			metadata: { title: 'NavigationStack', symbolKind: 'struct' },
			abstract: [{ text: 'Presents a stack of views.' }],
			deprecationSummary: [
				{
					type: 'paragraph',
					inlineContent: [{ type: 'text', text: 'Use ModernStack instead.' }],
				},
			],
			primaryContentSections: [
				{
					kind: 'declarations',
					declarations: [
						{
							tokens: [{ kind: 'keyword', text: 'struct' }, { kind: 'text', text: ' NavigationStack' }],
						},
					],
				},
				{
					kind: 'parameters',
					parameters: [
						{
							name: 'root',
							content: [{ type: 'paragraph', inlineContent: [{ type: 'text', text: 'The root view.' }] }],
						},
					],
				},
			],
			topicSections: [],
		}),
	};

	const handler = buildGetDocumentationHandler({
		client: mockClient,
		state: new ServerState(),
	});

	const res = await handler({ path: 'NavigationStack', framework: 'SwiftUI' });
	assert.strictEqual(res.isError, undefined);
	const text = res.content[0].text;
	assert.ok(text.includes('# NavigationStack'));
	assert.ok(text.includes('> [!WARNING]'));
	assert.ok(text.includes('Use ModernStack instead.'));
	assert.ok(text.includes('```swift\nstruct NavigationStack\n```'));
	assert.ok(text.includes('### Parameters'));
	assert.ok(text.includes('- `root`: The root view.'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcp-handlers.test.js`
Expected: FAIL

- [ ] **Step 3: Update `get-documentation.ts` and `symbol-resolution.ts`**

Update `src/server/services/symbol-resolution.ts` to accept optional target framework:
```typescript
const buildCandidatePaths = (
	technology: Technology,
	path: string,
	frameworkOverride?: string,
): string[] => {
	const normalizedPath = normalizePath(path.trim());
	const frameworkName = frameworkOverride || getFrameworkName(technology);
	const candidates = new Set<string>();

	if (normalizedPath && !normalizedPath.startsWith('documentation/')) {
		candidates.add(`documentation/${frameworkName}/${normalizedPath}`);
	}

	if (normalizedPath) {
		candidates.add(normalizedPath);
	}

	return [...candidates];
};
```

Update `src/server/handlers/get-documentation.ts` to integrate `docc-formatter`:
```typescript
import {
	formatDeclaration,
	formatDeprecation,
	formatParameters,
	formatDiscussion,
} from '../../apple-client/docc-formatter.js';
```
And assemble the markdown:
```typescript
const content: string[] = [
	header(1, title),
	'',
	bold('Technology', activeTechnology.title),
	bold('Type', kind),
	bold('Platforms', platforms),
	'',
];

const deprecation = formatDeprecation(data.deprecationSummary);
if (deprecation) {
	content.push(deprecation, '');
}

const declaration = formatDeclaration(data.primaryContentSections);
if (declaration) {
	content.push(header(2, 'Declaration'), declaration, '');
}

content.push(header(2, 'Overview'), description, '');

const parameters = formatParameters(data.primaryContentSections);
if (parameters) {
	content.push(parameters, '');
}

const discussion = formatDiscussion(data.primaryContentSections);
if (discussion) {
	content.push(header(2, 'Discussion'), discussion, '');
}

content.push(...formatTopicSections(data, client));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/mcp-handlers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/handlers/get-documentation.ts src/server/services/symbol-resolution.ts test/mcp-handlers.test.js
git commit -m "feat(server): integrate rich DocC AST formatting and framework scoping into get_documentation"
```

---

### Task 4: MCP Tool Schema & Description Streamlining

**Files:**
- Modify: `src/server/tools.ts`
- Modify: `README.md`
- Test: `test/mcp-protocol.test.js`

**Interfaces:**
- Consumes: `buildGetDocumentationHandler`
- Produces: Updated MCP tool schemas with `framework` argument and clear agent-centric descriptions.

- [ ] **Step 1: Write the failing test**

In `test/mcp-protocol.test.js`, assert that `get_documentation` tool schema contains optional `framework` property.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/mcp-protocol.test.js`
Expected: FAIL

- [ ] **Step 3: Update `src/server/tools.ts`**

Update `get_documentation` schema:
```typescript
{
	name: 'get_documentation',
	description:
		'Get detailed documentation for specific symbols, including Swift syntax declarations, parameters, deprecation notices, and code examples. ' +
		'Can be optionally scoped to a framework directly via the framework argument without needing choose_technology.',
	inputSchema: {
		type: 'object',
		required: ['path'],
		properties: {
			framework: {
				type: 'string',
				description:
					'Optional framework name (e.g. "SwiftUI", "UIKit"). If omitted, framework is auto-detected from path or local database.',
			},
			path: {
				type: 'string',
				description:
					'Symbol path or relative name (e.g. "View", "GridItem", "documentation/SwiftUI/NavigationStack")',
			},
		},
	},
	handler: (args) =>
		buildGetDocumentationHandler(context)(args as { path: string; framework?: string }),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/mcp-protocol.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/tools.ts README.md test/mcp-protocol.test.js
git commit -m "feat(mcp): expose framework parameter and rich doc capabilities in tool schema"
```

---

### Task 5: End-to-End Verification & Full Suite Pass

**Files:**
- Test: `test/e2e.test.js`
- Test: `test/**/*.test.js`

**Interfaces:**
- Consumes: All updated tools and handlers
- Produces: Green test suite across all 60+ tests.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: PASS across all test files with 0 failures.

- [ ] **Step 2: Live Verification with Real Apple DocC CDN**

Execute a smoke script querying real symbols (`NavigationStack`, `NavigationView`, `View.padding`) and verifying output structure.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test(e2e): verify enhanced DocC parsing against live Apple documentation"
```
