import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = path.resolve(__dirname, '../../desktop/plugin.js');

const ALLOWED_IMPORTS = new Set([
	'@hermes/plugin-sdk',
	'react',
	'react/jsx-runtime',
]);

test('desktop/plugin.js obeys strict @hermes/plugin-sdk static invariants', () => {
	const source = fs.readFileSync(PLUGIN_PATH, 'utf8');

	// 1. Only allowed module specifiers may be imported
	const importMatches = [
		...source.matchAll(/import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g),
	];
	assert.ok(
		importMatches.length >= 3,
		'Expected ESM imports in desktop/plugin.js',
	);
	for (const match of importMatches) {
		assert.ok(
			ALLOWED_IMPORTS.has(match[1]),
			`Disallowed import specifier: ${match[1]}`,
		);
	}

	// 2. No hardcoded color literals
	assert.equal(
		/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/.test(source),
		false,
		'desktop/plugin.js must use var(--ui-*) theme tokens, never hardcoded colors',
	);

	// 3. No forbidden legacy or browser-global escapes
	for (const forbidden of [
		'host.toast',
		'host.openPane',
		'host.togglePane',
		'window.open',
		'navigator.clipboard',
	]) {
		assert.equal(
			source.includes(forbidden),
			false,
			`desktop/plugin.js must not reference ${forbidden}`,
		);
	}

	// 4. Every capitalized component passed to jsx()/jsxs() must be imported or declared locally
	const jsxComponents = new Set(
		[...source.matchAll(/jsxs?\(\s*([A-Z][A-Za-z0-9_]*)\b/g)].map((m) => m[1]),
	);
	const importBlock = [...source.matchAll(/import\s*\{([\s\S]*?)\}\s*from/g)]
		.map((m) => m[1])
		.join(',');
	for (const comp of jsxComponents) {
		const isDeclared = new RegExp(
			`(?:function|const|let|var)\\s+${comp}\\b`,
		).test(source);
		const isImported = new RegExp(`\\b${comp}\\b`).test(importBlock);
		assert.ok(
			isDeclared || isImported,
			`Component ${comp} used in jsx()/jsxs() is neither imported nor declared`,
		);
	}
});

test('desktop/plugin.js registers valid HermesPlugin contributions and scoped panes', async () => {
	const revealedPanes = [];
	const undismissedPanes = [];

	globalThis.__APPLE_DOC_TEST_STUBS__ = {
		revealedPanes,
		undismissedPanes,
	};

	const loaderCode = `
		const noop = () => null;
		const stubs = globalThis.__APPLE_DOC_TEST_STUBS__;
		const sdkExports = {
			Badge: noop,
			Button: noop,
			Codicon: noop,
			CopyButton: noop,
			GlyphSpinner: noop,
			haptic: () => {},
			host: {
				navigate: () => {},
				notify: () => {},
				undismissPane: (id) => stubs.undismissedPanes.push(id),
				revealPane: (id) => stubs.revealedPanes.push(id),
				composer: {
					insertText: async () => true,
					setDraft: async () => true,
				},
			},
			Input: noop,
			PALETTE_AREA: 'palette',
			PANES_AREA: 'panes',
			ROUTES_AREA: 'routes',
			RowButton: noop,
			ScrollArea: noop,
			SegmentedControl: noop,
			Separator: noop,
			SIDEBAR_NAV_AREA: 'sidebar.nav',
			STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
			StatusDot: noop,
			Textarea: noop,
			Tip: noop,
			TRANSCRIPT_DIRECTIVE_AREA: 'transcript.directive',
			useMutation: () => ({ mutate: () => {}, data: null, isPending: false }),
			usePluginI18n: () => (k) => k,
			useQuery: () => ({ data: null, isFetching: false }),
		};

		export async function load(url, context, nextLoad) {
			if (url === 'mock://sdk') {
				const names = Object.keys(sdkExports);
				return {
					format: 'module',
					shortCircuit: true,
					source: names.map((n) => \`export const \${n} = globalThis.__SDK_EXPORTS__.\${n};\`).join('\\n'),
				};
			}
			if (url === 'mock://react') {
				return {
					format: 'module',
					shortCircuit: true,
					source: 'export const useEffect = () => {}; export const useMemo = (fn) => fn(); export const useState = (v) => [typeof v === "function" ? v() : v, () => {}];',
				};
			}
			if (url === 'mock://jsx') {
				return {
					format: 'module',
					shortCircuit: true,
					source: 'export const Fragment = (props) => props?.children ?? null; export const jsx = (type, props) => ({ type, props }); export const jsxs = (type, props) => ({ type, props });',
				};
			}
			return nextLoad(url, context);
		}

		export async function resolve(specifier, context, nextResolve) {
			if (specifier === '@hermes/plugin-sdk') return { url: 'mock://sdk', shortCircuit: true };
			if (specifier === 'react') return { url: 'mock://react', shortCircuit: true };
			if (specifier === 'react/jsx-runtime') return { url: 'mock://jsx', shortCircuit: true };
			return nextResolve(specifier, context);
		}
	`;

	// Populate global export bag for mock://sdk
	globalThis.__SDK_EXPORTS__ = {
		Badge: () => null,
		Button: () => null,
		Codicon: () => null,
		CopyButton: () => null,
		GlyphSpinner: () => null,
		haptic: () => {},
		host: {
			navigate: () => {},
			notify: () => {},
			undismissPane: (id) => undismissedPanes.push(id),
			revealPane: (id) => revealedPanes.push(id),
			composer: {
				insertText: async () => true,
				setDraft: async () => true,
			},
		},
		Input: () => null,
		PALETTE_AREA: 'palette',
		PANES_AREA: 'panes',
		ROUTES_AREA: 'routes',
		RowButton: () => null,
		ScrollArea: () => null,
		SegmentedControl: () => null,
		Separator: () => null,
		SIDEBAR_NAV_AREA: 'sidebar.nav',
		STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
		StatusDot: () => null,
		Textarea: () => null,
		Tip: () => null,
		TRANSCRIPT_DIRECTIVE_AREA: 'transcript.directive',
		useMutation: () => ({ mutate: () => {}, data: null, isPending: false }),
		usePluginI18n: () => (k) => k,
		useQuery: () => ({ data: null, isFetching: false }),
	};

	register(
		`data:text/javascript;base64,${Buffer.from(loaderCode).toString('base64')}`,
	);

	const mod = await import(
		`${pathToFileURL(PLUGIN_PATH).href}?t=${Date.now()}`
	);
	const plugin = mod.default;

	assert.equal(plugin.id, 'apple-doc-plugin');
	assert.equal(plugin.defaultEnabled, true);
	assert.equal(typeof plugin.register, 'function');
	assert.equal('activate' in plugin, false);
	assert.equal('deactivate' in plugin, false);

	const registered = [];
	let i18nBundles = null;
	const mockCtx = {
		i18n: {
			register(bundles) {
				i18nBundles = bundles;
				return () => {};
			},
		},
		registerMany(entries) {
			registered.push(...entries);
			return () => {};
		},
		register(entry) {
			registered.push(entry);
			return () => {};
		},
		os: {
			openExternal: () => true,
			writeClipboard: async () => true,
		},
		rest: async () => ({}),
	};

	const dispose = plugin.register(mockCtx);
	assert.equal(typeof dispose, 'function');
	assert.equal(registered.length, 9);
	assert.ok(
		i18nBundles && i18nBundles.en && i18nBundles.ar,
		'Plugin must register en and ar i18n bundles',
	);

	const panes = registered.filter((c) => c.area === 'panes');
	assert.equal(
		panes.length,
		2,
		'Plugin must register 2 panes so closing one does not disable the plugin',
	);

	const sidebar = registered.find((c) => c.area === 'sidebar.nav');
	assert.equal(sidebar.data.path, '/apple-docs');
	assert.equal('action' in sidebar, false);
	assert.equal('onClick' in sidebar, false);

	const openStudioPalette = registered.find((c) => c.id === 'palette-open');
	openStudioPalette.data.run();
	assert.deepEqual(undismissedPanes, ['apple-doc-plugin:inspector-pane']);
	assert.deepEqual(revealedPanes, ['apple-doc-plugin:inspector-pane']);

	delete globalThis.__APPLE_DOC_TEST_STUBS__;
	delete globalThis.__SDK_EXPORTS__;
});
