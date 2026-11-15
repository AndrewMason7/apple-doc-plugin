import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './mock-sdk-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const BUNDLE_PATH = path.resolve(REPO_ROOT, 'desktop/plugin.js');
const SRC_DIR = path.resolve(REPO_ROOT, 'desktop/src');

// ----------------------------------------------------------------------------
// Suite 1: Baseline Data & Logic Equivalence against origin/main
// ----------------------------------------------------------------------------
test('Strict Regression: baseline data sets match origin/main verbatim', async () => {
	const originSource = execSync('git show origin/main:desktop/plugin.js', {
		cwd: REPO_ROOT,
		encoding: 'utf8',
	});

	// Extract original FALLBACK_STATS
	const origStatsMatch = originSource.match(
		/const FALLBACK_STATS = ({[\s\S]*?\n};)/,
	);
	assert.ok(
		origStatsMatch,
		'Original FALLBACK_STATS must exist in origin/main',
	);
	const origStats = new Function(`return ${origStatsMatch[1]}`)();

	// Extract original FALLBACK_SYMBOLS
	const origSymbolsMatch = originSource.match(
		/const FALLBACK_SYMBOLS = (\[[\s\S]*?\n\];)/,
	);
	assert.ok(
		origSymbolsMatch,
		'Original FALLBACK_SYMBOLS must exist in origin/main',
	);
	const origSymbols = new Function(`return ${origSymbolsMatch[1]}`)();

	// Extract original FALLBACK_IDIOMS
	const origIdiomsMatch = originSource.match(
		/const FALLBACK_IDIOMS = (\[[\s\S]*?\n\];)/,
	);
	assert.ok(
		origIdiomsMatch,
		'Original FALLBACK_IDIOMS must exist in origin/main',
	);
	const origIdioms = new Function(`return ${origIdiomsMatch[1]}`)();

	// Extract original COMPILER_PRESETS
	const origPresetsMatch = originSource.match(
		/const COMPILER_PRESETS = (\[[\s\S]*?\n\];)/,
	);
	assert.ok(
		origPresetsMatch,
		'Original COMPILER_PRESETS must exist in origin/main',
	);
	const origPresets = new Function(`return ${origPresetsMatch[1]}`)();

	// Extract original LOCAL_MIGRATIONS
	const origMigrationsMatch = originSource.match(
		/const LOCAL_MIGRATIONS = ({[\s\S]*?\n};)/,
	);
	assert.ok(
		origMigrationsMatch,
		'Original LOCAL_MIGRATIONS must exist in origin/main',
	);
	const origMigrations = new Function(`return ${origMigrationsMatch[1]}`)();

	// Load refactored module datasets
	const {
		FALLBACK_STATS,
		FALLBACK_SYMBOLS,
		FALLBACK_IDIOMS,
		COMPILER_PRESETS,
		LOCAL_MIGRATIONS,
	} = await import('../../desktop/src/data/fallbacks.js');
	const { PLUGIN_ID, STUDIO_ROUTE, TOP_FRAMEWORK_PILLS } =
		await import('../../desktop/src/data/constants.js');

	// Assert strict deep equality with origin baseline
	assert.equal(PLUGIN_ID, 'apple-doc-plugin');
	assert.equal(STUDIO_ROUTE, '/apple-docs');
	assert.deepEqual(TOP_FRAMEWORK_PILLS, [
		'',
		'SwiftUI',
		'SwiftData',
		'Observation',
		'Foundation',
		'UIKit',
		'AppKit',
		'Security',
		'StoreKit',
		'Vision',
	]);

	assert.deepEqual(
		FALLBACK_STATS,
		origStats,
		'FALLBACK_STATS must match origin/main verbatim',
	);
	assert.deepEqual(
		FALLBACK_SYMBOLS,
		origSymbols,
		'FALLBACK_SYMBOLS must match origin/main verbatim',
	);
	assert.deepEqual(
		FALLBACK_IDIOMS,
		origIdioms,
		'FALLBACK_IDIOMS must match origin/main verbatim',
	);
	assert.deepEqual(
		COMPILER_PRESETS,
		origPresets,
		'COMPILER_PRESETS must match origin/main verbatim',
	);
	assert.deepEqual(
		LOCAL_MIGRATIONS,
		origMigrations,
		'LOCAL_MIGRATIONS must match origin/main verbatim',
	);
});

// ----------------------------------------------------------------------------
// Suite 2: Search & Diagnostics Algorithmic Equivalence
// ----------------------------------------------------------------------------
test('Strict Regression: search and diagnostic fallback algorithms maintain exact behavior', async () => {
	const { localSearchFallback, localDiagnoseFallback } =
		await import('../../desktop/src/services/search-service.js');

	// 1. Curated preview on empty input
	const emptyRes = localSearchFallback('', '');
	assert.equal(emptyRes.mode, 'curated-preview');
	assert.equal(emptyRes.offlineFallback, true);
	assert.ok(emptyRes.results.length >= 8);

	// 2. Whitespace-only input
	const wsRes = localSearchFallback('   ', '');
	assert.equal(wsRes.mode, 'curated-preview');
	assert.equal(wsRes.results.length, emptyRes.results.length);

	// 3. Exact symbol lookup
	const splitViewRes = localSearchFallback('NavigationSplitView', 'SwiftUI');
	assert.ok(splitViewRes.results.length >= 1);
	assert.equal(splitViewRes.results[0].title, 'NavigationSplitView');
	assert.equal(splitViewRes.results[0].framework, 'SwiftUI');

	// 4. Case insensitivity
	const caseRes = localSearchFallback('navigationsplitview', 'swiftui');
	assert.equal(caseRes.results[0].title, 'NavigationSplitView');

	// 5. Zero-match query hygiene (MUST NOT substitute random results)
	const zeroRes = localSearchFallback('RandomUnmatchedString999', 'SwiftUI');
	assert.deepEqual(
		zeroRes.results,
		[],
		'Must return an empty array on zero match',
	);
	assert.equal(zeroRes.offlineFallback, true);

	// 6. Cross-framework idiom mapping
	const storageRes = localSearchFallback('localStorage', '');
	assert.equal(storageRes.mode, 'offline-fallback-idiom');
	assert.ok(storageRes.expansion.matchedIdioms.length > 0);
	const storageTitles = storageRes.results.map((r) => r.title);
	assert.ok(
		storageTitles.includes('AppStorage'),
		'localStorage idiom must resolve to SwiftUI AppStorage',
	);

	const effectRes = localSearchFallback('useEffect', '');
	assert.equal(effectRes.mode, 'offline-fallback-idiom');
	const effectTitles = effectRes.results.map((r) => r.title);
	assert.ok(
		effectTitles.some((t) => t.includes('task')),
		'useEffect idiom must resolve to Swift task(id:priority:_:) modifier',
	);

	// 7. Compiler log diagnosis
	const diagEmpty = localDiagnoseFallback('');
	assert.equal(diagEmpty.matched, false);
	assert.deepEqual(diagEmpty.findings, []);

	const diagSingle = localDiagnoseFallback(
		"Cannot find 'NavigationView' in scope",
	);
	assert.equal(diagSingle.matched, true);
	assert.equal(diagSingle.findings.length, 1);
	assert.equal(diagSingle.findings[0].symbol, 'NavigationView');
	assert.ok(diagSingle.findings[0].replacement.includes('NavigationStack'));

	const diagMulti = localDiagnoseFallback(
		"error: 'NavigationView' is deprecated\nerror: 'ObservableObject' is deprecated",
	);
	assert.equal(diagMulti.matched, true);
	assert.equal(diagMulti.findings.length, 2);
	const syms = diagMulti.findings.map((f) => f.symbol);
	assert.ok(
		syms.includes('NavigationView') && syms.includes('ObservableObject'),
	);
});

// ----------------------------------------------------------------------------
// Suite 3: Host Bridge Resilience & Fallback Coverage
// ----------------------------------------------------------------------------
test('Strict Regression: host bridge functions handle null/hostile environments gracefully', async () => {
	const {
		safeHaptic,
		safeNavigate,
		safeOpenPane,
		safeNotify,
		safeWriteClipboard,
		safeOpenExternal,
		insertIntoChatComposer,
		sendDemoCommandInChat,
	} = await import('../../desktop/src/services/host-bridge.js');

	// No exceptions when host or window are missing
	assert.doesNotThrow(() => safeHaptic('tap'));
	assert.doesNotThrow(() => safeHaptic('heavy'));
	assert.doesNotThrow(() => safeNavigate('/apple-docs'));
	assert.doesNotThrow(() => safeNotify('Unit test notification', 'info'));
	assert.doesNotThrow(() => safeNotify('Error test notification', 'error'));

	// Pane opening handles scoped and unscoped IDs
	assert.equal(safeOpenPane('inspector-pane'), true);
	assert.equal(safeOpenPane('apple-doc-plugin:inspector-pane'), true);

	// Clipboard and External URL operations return boolean status
	assert.equal(await safeWriteClipboard(null, 'text'), false);
	assert.equal(safeOpenExternal(null, 'https://developer.apple.com'), false);

	// Mock context with working clipboard
	let clipboardBuffer = '';
	const mockCtx = {
		os: {
			writeClipboard: async (text) => {
				clipboardBuffer = text;
				return true;
			},
			openExternal: (url) => url.startsWith('https://'),
		},
	};

	assert.equal(await safeWriteClipboard(mockCtx, 'test clipboard text'), true);
	assert.equal(clipboardBuffer, 'test clipboard text');
	assert.equal(safeOpenExternal(mockCtx, 'https://apple.com'), true);
	assert.equal(safeOpenExternal(mockCtx, 'http://insecure.com'), false);

	// insertIntoChatComposer and sendDemoCommandInChat with mock host composer
	await assert.doesNotReject(async () => {
		await insertIntoChatComposer(mockCtx, 'NavigationStack', false);
	});
	await assert.doesNotReject(async () => {
		await sendDemoCommandInChat(mockCtx);
	});
});

// ----------------------------------------------------------------------------
// Suite 4: Deep Recursive UI Component Render Traversal
// ----------------------------------------------------------------------------
test('Strict Regression: full component render trees mount recursively without runtime errors', async () => {
	const { AppleDocsStudioPage } =
		await import('../../desktop/src/views/studio/AppleDocsStudioPage.js');
	const { AppleDocsSidePane } =
		await import('../../desktop/src/views/panes/AppleDocsSidePane.js');
	const { AppleDocsCompilerPane } =
		await import('../../desktop/src/views/panes/AppleDocsCompilerPane.js');
	const { AppleDocsStatusChip } =
		await import('../../desktop/src/views/status/AppleDocsStatusChip.js');
	const { InlineAppleDocCard } =
		await import('../../desktop/src/components/InlineAppleDocCard.js');
	const { SymbolInspectorDetail } =
		await import('../../desktop/src/components/SymbolInspectorDetail.js');
	const { GlyphSpinner } =
		await import('../../desktop/src/components/GlyphSpinner.js');

	// Recursive tree evaluator: walks and executes any nested functional component
	function evaluateTree(node, depth = 0) {
		if (!node || depth > 20) return;
		if (typeof node.type === 'function') {
			const rendered = node.type(node.props || {});
			evaluateTree(rendered, depth + 1);
		}
		if (node.props?.children) {
			if (Array.isArray(node.props.children)) {
				for (const child of node.props.children) {
					evaluateTree(child, depth + 1);
				}
			} else {
				evaluateTree(node.props.children, depth + 1);
			}
		}
	}

	const dummyCtx = {
		rest: async () => ({ ok: true, symbolCount: 95899 }),
		os: { writeClipboard: async () => true, openExternal: () => true },
	};

	// 1. Studio Page
	const studio = AppleDocsStudioPage({ ctx: dummyCtx });
	assert.ok(studio);
	assert.doesNotThrow(() => evaluateTree(studio));

	// 2. Side Pane (Quick Lookup)
	const sidePane = AppleDocsSidePane({ ctx: dummyCtx });
	assert.ok(sidePane);
	assert.doesNotThrow(() => evaluateTree(sidePane));

	// 3. Compiler Pane (Xcode Errors)
	const compilerPane = AppleDocsCompilerPane({ ctx: dummyCtx });
	assert.ok(compilerPane);
	assert.doesNotThrow(() => evaluateTree(compilerPane));

	// 4. Status Chip
	const chip = AppleDocsStatusChip({ ctx: dummyCtx });
	assert.ok(chip);
	assert.doesNotThrow(() => evaluateTree(chip));

	// 5. GlyphSpinner
	const spinner = GlyphSpinner({ className: 'custom-spin' });
	assert.ok(spinner);
	assert.doesNotThrow(() => evaluateTree(spinner));

	// 6. SymbolInspectorDetail with null, minimal, and fully populated doc items
	const emptyDetail = SymbolInspectorDetail({ ctx: dummyCtx, item: null });
	assert.doesNotThrow(() => evaluateTree(emptyDetail));

	const fullItem = {
		title: 'NavigationSplitView',
		framework: 'SwiftUI',
		kind: 'struct',
		path: '/documentation/swiftui/navigationsplitview',
		platforms: ['iOS 16.0+', 'macOS 13.0+'],
		declaration: 'struct NavigationSplitView<Sidebar, Content, Detail> : View',
		abstract: 'A view that presents views in two or three columns.',
		topics: [
			{
				title: 'Initializers',
				items: [{ title: 'init(sidebar:content:detail:)' }],
			},
		],
	};
	const populatedDetail = SymbolInspectorDetail({
		ctx: dummyCtx,
		item: fullItem,
		liveDoc: fullItem,
		loadingDoc: false,
	});
	assert.doesNotThrow(() => evaluateTree(populatedDetail));

	// 7. InlineAppleDocCard across diverse attribute shapes
	const normalCard = InlineAppleDocCard({
		ctx: dummyCtx,
		attrs: { title: 'Button', framework: 'SwiftUI', platforms: ['iOS 13+'] },
	});
	assert.doesNotThrow(() => evaluateTree(normalCard));

	const fallbackCard = InlineAppleDocCard({
		ctx: dummyCtx,
		attrs: {
			symbol: 'Text',
			summary: 'A view that displays one or more lines of read-only text.',
		},
	});
	assert.doesNotThrow(() => evaluateTree(fallbackCard));

	const stringPlatformsCard = InlineAppleDocCard({
		ctx: dummyCtx,
		attrs: {
			title: 'VStack',
			platforms: 'iOS 13.0+, macOS 10.15+, watchOS 6.0+',
		},
	});
	assert.doesNotThrow(() => evaluateTree(stringPlatformsCard));

	const malformedAttrsCard = InlineAppleDocCard({
		ctx: dummyCtx,
		attrs: { title: null, platforms: 12345, path: true },
	});
	assert.doesNotThrow(() => evaluateTree(malformedAttrsCard));
});

// ----------------------------------------------------------------------------
// Suite 5: Source Tree AST and Invariant Audit across All Modular Source Files
// ----------------------------------------------------------------------------
test('Strict Regression: runtime register(ctx) produces identical contribution descriptors as origin/main', async () => {
	const originSource = execSync('git show origin/main:desktop/plugin.js', {
		cwd: REPO_ROOT,
		encoding: 'utf8',
	});

	const tmpOrigPath = path.resolve(REPO_ROOT, 'test/unit/.tmp-orig-plugin.js');
	fs.writeFileSync(tmpOrigPath, originSource);

	try {
		const origMod = await import(
			`${pathToFileURL(tmpOrigPath).href}?t=${Date.now()}`
		);
		const newMod = await import(
			`${pathToFileURL(BUNDLE_PATH).href}?t=${Date.now()}`
		);

		const origRegistered = [];
		const newRegistered = [];

		const createCtx = (sink) => ({
			i18n: { register: () => () => {} },
			registerMany: (entries) => {
				sink.push(...entries);
				return () => {};
			},
			register: (entry) => {
				sink.push(entry);
				return () => {};
			},
		});

		origMod.default.register(createCtx(origRegistered));
		newMod.default.register(createCtx(newRegistered));

		assert.equal(origRegistered.length, newRegistered.length);
		assert.equal(
			newRegistered.length,
			9,
			'Must register exactly 9 contributions',
		);

		for (let i = 0; i < origRegistered.length; i++) {
			const orig = origRegistered[i];
			const curr = newRegistered[i];

			assert.equal(curr.id, orig.id, `Contribution ${i} ID mismatch`);
			assert.equal(
				curr.area,
				orig.area,
				`Contribution ${curr.id} area mismatch`,
			);
			assert.equal(
				curr.title,
				orig.title,
				`Contribution ${curr.id} title mismatch`,
			);
			assert.equal(
				curr.order,
				orig.order,
				`Contribution ${curr.id} order mismatch`,
			);

			if (orig.data && typeof orig.data === 'object') {
				assert.ok(curr.data, `Contribution ${curr.id} missing data`);
				// Compare data keys and primitive values
				for (const key of Object.keys(orig.data)) {
					if (typeof orig.data[key] !== 'function') {
						assert.deepEqual(
							curr.data[key],
							orig.data[key],
							`Contribution ${curr.id} data.${key} mismatch`,
						);
					}
				}
			}
		}
	} finally {
		if (fs.existsSync(tmpOrigPath)) {
			fs.unlinkSync(tmpOrigPath);
		}
	}
});

// ----------------------------------------------------------------------------
// Suite 6: Source Tree AST and Invariant Audit across All Modular Source Files
// ----------------------------------------------------------------------------
test('Strict Regression: all modular source files in desktop/src/ adhere to Hermes constraints', () => {
	function getAllJsFiles(dir) {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		const files = [];
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...getAllJsFiles(fullPath));
			} else if (entry.name.endsWith('.js')) {
				files.push(fullPath);
			}
		}
		return files;
	}

	const srcFiles = getAllJsFiles(SRC_DIR);
	assert.ok(srcFiles.length >= 8, `Expected modular files in ${SRC_DIR}`);

	const forbiddenGlobals = [
		'host.toast',
		'host.openPane',
		'host.togglePane',
		'window.open',
		'navigator.clipboard',
	];

	const badCssVars = [
		'(--ui-text)',
		'(--ui-input)',
		'(--ui-hover)',
		'(--ui-surface)',
	];

	for (const file of srcFiles) {
		const code = fs.readFileSync(file, 'utf8');
		const relName = path.relative(REPO_ROOT, file);

		// No hardcoded colors
		assert.equal(
			/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/.test(code),
			false,
			`${relName} must not contain hardcoded colors (#hex, rgb, hsl)`,
		);

		// No invalid CSS variables
		for (const badToken of badCssVars) {
			assert.equal(
				code.includes(badToken),
				false,
				`${relName} must not reference non-existent CSS variable ${badToken}`,
			);
		}

		// No forbidden host/browser APIs
		for (const forbidden of forbiddenGlobals) {
			assert.equal(
				code.includes(forbidden),
				false,
				`${relName} must not call forbidden global ${forbidden}`,
			);
		}
	}
});
