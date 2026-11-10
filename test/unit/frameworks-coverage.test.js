import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import { safeEnsureRuntimeDbSeeded } from '../../dist/server/db/db-path.js';

test('Expanded frameworks coverage: key symbols from target frameworks are present and resolvable', () => {
	const dbPath = safeEnsureRuntimeDbSeeded();
	const db = new AppleDocsDB(dbPath, { readonly: true });

	const keySymbols = [
		{
			name: 'SecItemAdd',
			framework: 'Security',
			pathPrefix: '/documentation/security/',
			expectedKind: 'func',
		},
		{
			name: 'WKWebView',
			framework: 'WebKit',
			pathPrefix: '/documentation/webkit/',
			expectedKind: 'class',
			isPrimaryType: true,
		},
		{
			name: 'MKMapView',
			framework: 'MapKit',
			pathPrefix: '/documentation/mapkit/',
			expectedKind: 'class',
			isPrimaryType: true,
		},
		{
			name: 'SKPaymentQueue',
			framework: 'StoreKit',
			pathPrefix: '/documentation/storekit/',
			expectedKind: 'class',
			isPrimaryType: true,
		},
		{
			name: 'AVPlayer',
			framework: 'AVFoundation',
			pathPrefix: '/documentation/avfoundation/',
			expectedKind: 'class',
			isPrimaryType: true,
		},
		{
			name: 'NSManagedObject',
			framework: 'CoreData',
			pathPrefix: '/documentation/coredata/',
			expectedKind: 'class',
			isPrimaryType: true,
		},
		{
			name: 'Entity',
			framework: 'RealityKit',
			pathPrefix: '/documentation/realitykit/',
			expectedKind: 'class',
			isPrimaryType: true,
		},
		{
			name: 'VNRecognizeTextRequest',
			framework: 'Vision',
			pathPrefix: '/documentation/vision/',
			expectedKind: 'class',
			isPrimaryType: true,
		},
		{
			name: 'ASAuthorizationAppleIDProvider',
			framework: 'AuthenticationServices',
			pathPrefix: '/documentation/authenticationservices/',
			expectedKind: 'class',
			isPrimaryType: true,
		},
		{
			name: 'LAContext',
			framework: 'LocalAuthentication',
			pathPrefix: '/documentation/localauthentication/',
			expectedKind: 'class',
			isPrimaryType: true,
		},
	];

	for (const expected of keySymbols) {
		// 1. Direct symbol resolution via db.resolveSymbol
		const resolution = db.resolveSymbol(expected.name, expected.framework);
		const match = resolution.symbol || resolution.candidates?.[0];
		assert.ok(
			match,
			`Symbol ${expected.name} must resolve in framework ${expected.framework} via db.resolveSymbol`,
		);
		assert.strictEqual(
			match.framework,
			expected.framework,
			`Symbol ${expected.name} must be attributed to ${expected.framework}, got ${match.framework}`,
		);
		assert.ok(
			match.path.startsWith(expected.pathPrefix),
			`Symbol ${expected.name} path ${match.path} should start with ${expected.pathPrefix}`,
		);

		if (expected.expectedKind) {
			assert.strictEqual(
				match.kind,
				expected.expectedKind,
				`Symbol ${expected.name} kind should be ${expected.expectedKind}, got ${match.kind}`,
			);
		}

		if (expected.isPrimaryType !== undefined) {
			assert.strictEqual(
				Boolean(match.isPrimaryType ?? match.is_primary_type),
				expected.isPrimaryType,
				`Symbol ${expected.name} isPrimaryType should be ${expected.isPrimaryType}`,
			);
		}

		// Verify platforms are populated
		const parsedPlatforms =
			typeof match.platforms === 'string'
				? JSON.parse(match.platforms)
				: match.platforms;
		assert.ok(
			Array.isArray(parsedPlatforms) && parsedPlatforms.length > 0,
			`Symbol ${expected.name} should have populated default platforms, got: ${match.platforms}`,
		);

		// 2. FTS search resolvable
		const ftsResults = db.queryFTS(expected.name, expected.framework, 10);
		assert.ok(
			ftsResults.length > 0,
			`Expected FTS search for "${expected.name}" in ${expected.framework} to return results`,
		);
		const ftsMatch = ftsResults.find(
			(r) =>
				r.title === expected.name ||
				r.title.includes(expected.name) ||
				r.path.toLowerCase().includes(`/${expected.name.toLowerCase()}`),
		);
		assert.ok(
			ftsMatch,
			`FTS search for "${expected.name}" should include target symbol, got: ${ftsResults.map((r) => r.title).join(', ')}`,
		);
	}

	// 3. Minimum breadth coverage for each target framework
	const targetFrameworks = [
		'Security',
		'AVFoundation',
		'WebKit',
		'StoreKit',
		'MapKit',
		'CoreData',
		'RealityKit',
		'Vision',
		'AuthenticationServices',
		'LocalAuthentication',
	];

	for (const fw of targetFrameworks) {
		const countRow = db.db
			.prepare(`SELECT count(*) as count FROM symbols WHERE framework = ?`)
			.get(fw);
		assert.ok(
			countRow && countRow.count >= 50,
			`Framework ${fw} must have substantial coverage (>= 50 symbols), found ${countRow?.count ?? 0}`,
		);
	}

	db.close();
});

test('Expanded frameworks coverage: search_symbols handler returns target framework symbols cleanly', async () => {
	const dbPath = safeEnsureRuntimeDbSeeded();
	const db = new AppleDocsDB(dbPath, { readonly: true });
	const { HybridSearchEngine } =
		await import('../../dist/server/services/search/hybrid-search.js');
	const { buildSearchSymbolsHandler } =
		await import('../../dist/server/handlers/search-symbols.js');
	const { ServerState } = await import('../../dist/server/state.js');

	const searchEngine = new HybridSearchEngine(db);
	const handler = buildSearchSymbolsHandler({
		client: {},
		state: new ServerState(),
		db,
		searchEngine,
	});

	// Test 1: SecItemAdd in Security
	const secRes = await handler({
		query: 'SecItemAdd',
		framework: 'Security',
	});
	assert.ok(
		secRes.content[0].text.includes('/documentation/security/secitemadd'),
		'Should find SecItemAdd in Security search',
	);

	// Test 2: WKWebView in WebKit
	const webRes = await handler({
		query: 'WKWebView',
		framework: 'WebKit',
	});
	assert.ok(
		webRes.content[0].text.includes('/documentation/webkit/wkwebview'),
		'Should find WKWebView in WebKit search',
	);

	// Test 3: AVPlayer in AVFoundation
	const avRes = await handler({
		query: 'AVPlayer',
		framework: 'AVFoundation',
	});
	assert.ok(
		avRes.content[0].text.includes('/documentation/avfoundation/avplayer'),
		'Should find AVPlayer in AVFoundation search',
	);

	// Test 4: MKMapView in MapKit
	const mapRes = await handler({
		query: 'MKMapView',
		framework: 'MapKit',
	});
	assert.ok(
		mapRes.content[0].text.includes('/documentation/mapkit/mkmapview'),
		'Should find MKMapView in MapKit search',
	);

	// Test 5: get_documentation handler resolves bare C function name SecItemAdd
	const { buildGetDocumentationHandler } =
		await import('../../dist/server/handlers/get-documentation.js');
	const docHandler = buildGetDocumentationHandler({
		client: {},
		state: new ServerState(),
		db,
	});

	const secDoc = await docHandler({
		path: 'SecItemAdd',
		framework: 'Security',
	});
	assert.strictEqual(
		secDoc.isError,
		undefined,
		'get_documentation should not return an error for SecItemAdd',
	);
	assert.ok(
		secDoc.content[0].text.includes('SecItemAdd'),
		'SecItemAdd documentation should include symbol title',
	);
	assert.ok(
		secDoc.content[0].text.includes('Adds one or more items to a keychain.'),
		'SecItemAdd documentation should include authentic DocC abstract',
	);

	// Test 6: get_documentation handler resolves class WKWebView
	const webDoc = await docHandler({
		path: 'WKWebView',
		framework: 'WebKit',
	});
	assert.strictEqual(
		webDoc.isError,
		undefined,
		'get_documentation should not return an error for WKWebView',
	);
	assert.ok(
		webDoc.content[0].text.includes('WKWebView'),
		'WKWebView documentation should include symbol title',
	);
	assert.ok(
		webDoc.content[0].text.includes('interactive web content'),
		'WKWebView documentation should include authentic DocC abstract',
	);

	db.close();
});

test('Expanded frameworks coverage: database integrity has 0 attribution mismatches and 0 unknown kinds', () => {
	const dbPath = safeEnsureRuntimeDbSeeded();
	const db = new AppleDocsDB(dbPath, { readonly: true });

	assert.strictEqual(
		db.countFrameworkPathMismatches(),
		0,
		'There should be 0 framework attribution mismatches in the expanded index',
	);

	assert.strictEqual(
		db.countUnknownKind(),
		0,
		'There should be 0 unknown/unclassified kinds in the expanded index',
	);

	const totalCount = db.getSymbolCount();
	assert.ok(
		totalCount >= 90000,
		`Expected at least 90,000 symbols in the expanded database, found ${totalCount}`,
	);

	db.close();
});
