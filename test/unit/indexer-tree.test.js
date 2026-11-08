import assert from 'node:assert';
import test from 'node:test';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import { indexFrameworkTree } from '../../dist/server/services/indexer.js';

test('indexFrameworkTree indexes symbols from both swift and occ trees without duplicates, giving swift titles priority on collision', () => {
	const db = new AppleDocsDB(':memory:');
	const mockIndexData = {
		interfaceLanguages: {
			swift: [
				{
					title: 'Security',
					path: '/documentation/security',
					type: 'module',
					children: [
						{
							title: 'SecItemAdd(_:_:)',
							path: '/documentation/security/secitemadd',
							type: 'func',
						},
						{
							title: 'SecAccessControl',
							path: '/documentation/security/secaccesscontrol',
							type: 'struct',
						},
					],
				},
			],
			occ: [
				{
					title: 'Security',
					path: '/documentation/security',
					type: 'module',
					children: [
						{
							title: 'SecItemAdd',
							path: '/documentation/security/secitemadd',
							type: 'func',
						},
						{
							title: 'SecKeyCreateRandomKey',
							path: '/documentation/security/seckeycreaterandomkey',
							type: 'func',
						},
					],
				},
			],
		},
	};

	const count = indexFrameworkTree(db, 'Security', mockIndexData);
	assert.strictEqual(count, 4);

	const secItemAdd = db.getSymbolByPath('/documentation/security/secitemadd');
	assert.ok(secItemAdd, 'SecItemAdd symbol should exist');
	assert.strictEqual(
		secItemAdd.title,
		'SecItemAdd(_:_:)',
		'Swift title should take precedence over Objective-C title',
	);

	const secKey = db.getSymbolByPath(
		'/documentation/security/seckeycreaterandomkey',
	);
	assert.ok(secKey, 'SecKeyCreateRandomKey from occ tree should be indexed');
	assert.strictEqual(secKey.title, 'SecKeyCreateRandomKey');

	const secAccess = db.getSymbolByPath(
		'/documentation/security/secaccesscontrol',
	);
	assert.ok(secAccess, 'SecAccessControl from swift tree should be indexed');
	assert.strictEqual(secAccess.title, 'SecAccessControl');

	db.close();
});

test('indexFrameworkTree indexes frameworks that only have occ interface trees', () => {
	const db = new AppleDocsDB(':memory:');
	const occOnlyData = {
		interfaceLanguages: {
			occ: [
				{
					title: 'CoreServices',
					path: '/documentation/coreservices',
					type: 'module',
					children: [
						{
							title: 'UTTypeCreatePreferredIdentifierForTag',
							path: '/documentation/coreservices/uttypecreatepreferredidentifierfortag',
							type: 'func',
						},
					],
				},
			],
		},
	};

	const count = indexFrameworkTree(db, 'CoreServices', occOnlyData);
	assert.strictEqual(count, 2);

	const sym = db.getSymbolByPath(
		'/documentation/coreservices/uttypecreatepreferredidentifierfortag',
	);
	assert.ok(sym, 'Symbol from occ-only tree should be indexed');
	assert.strictEqual(sym.title, 'UTTypeCreatePreferredIdentifierForTag');

	db.close();
});

test('indexFrameworkTree traverses nested children and skips groupMarker nodes', () => {
	const db = new AppleDocsDB(':memory:');
	const nestedData = {
		interfaceLanguages: {
			swift: [
				{
					title: 'WebKit',
					path: '/documentation/webkit',
					type: 'module',
					children: [
						{
							title: 'Views',
							type: 'groupMarker',
							children: [
								{
									title: 'WKWebView',
									path: '/documentation/webkit/wkwebview',
									type: 'class',
								},
							],
						},
					],
				},
			],
		},
	};

	const count = indexFrameworkTree(db, 'WebKit', nestedData);
	assert.strictEqual(count, 2);

	const webView = db.getSymbolByPath('/documentation/webkit/wkwebview');
	assert.ok(webView);
	assert.strictEqual(webView.title, 'WKWebView');
	assert.strictEqual(webView.isPrimaryType, true);

	db.close();
});

test('indexFrameworkTree deduplicates intra-tree paths and supports non-array root objects', () => {
	const db = new AppleDocsDB(':memory:');
	const singleRootData = {
		interfaceLanguages: {
			swift: {
				title: 'AVFoundation',
				path: '/documentation/avfoundation',
				type: 'module',
				children: [
					{
						title: 'AVPlayer',
						path: '/documentation/avfoundation/avplayer',
						type: 'class',
					},
					// Duplicate entry in the same tree
					{
						title: 'AVPlayer (duplicate)',
						path: '/documentation/avfoundation/avplayer',
						type: 'class',
					},
				],
			},
			occ: {
				title: 'AVPlayer',
				path: '/documentation/avfoundation/avplayer',
				type: 'class',
			},
		},
	};

	const count = indexFrameworkTree(db, 'AVFoundation', singleRootData);
	assert.strictEqual(count, 2);

	const player = db.getSymbolByPath('/documentation/avfoundation/avplayer');
	assert.ok(player);
	assert.strictEqual(player.title, 'AVPlayer');

	db.close();
});

test('indexFrameworkTree handles cross-framework path attribution and custom platforms', () => {
	const db = new AppleDocsDB(':memory:');
	const crossData = {
		interfaceLanguages: {
			swift: [
				{
					title: 'SwiftUI',
					path: '/documentation/swiftui',
					type: 'module',
					children: [
						{
							title: 'UIView',
							path: '/documentation/uikit/uiview',
							type: 'class',
						},
					],
				},
			],
		},
	};

	const count = indexFrameworkTree(db, 'SwiftUI', crossData, [
		'iOS',
		'Mac Catalyst',
	]);
	assert.strictEqual(count, 2);

	const uiView = db.getSymbolByPath('/documentation/uikit/uiview');
	assert.ok(uiView);
	assert.strictEqual(uiView.framework, 'UIKit');
	assert.deepStrictEqual(uiView.platforms, ['iOS', 'Mac Catalyst']);

	db.close();
});

test('indexFrameworkTree handles null and undefined children resiliently', () => {
	const db = new AppleDocsDB(':memory:');
	const sparseData = {
		interfaceLanguages: {
			swift: [
				null,
				{
					title: 'StoreKit',
					path: '/documentation/storekit',
					type: 'module',
					children: [
						null,
						undefined,
						{
							title: 'Product',
							path: '/documentation/storekit/product',
							type: 'struct',
							children: null,
						},
					],
				},
			],
			occ: [null],
		},
	};

	const count = indexFrameworkTree(db, 'StoreKit', sparseData);
	assert.strictEqual(count, 2);

	const prod = db.getSymbolByPath('/documentation/storekit/product');
	assert.ok(prod);
	assert.strictEqual(prod.title, 'Product');

	db.close();
});

test('indexFrameworkTree returns 0 for empty or missing interfaceLanguages', () => {
	const db = new AppleDocsDB(':memory:');
	assert.strictEqual(indexFrameworkTree(db, 'Security', {}), 0);
	assert.strictEqual(indexFrameworkTree(db, 'Security', null), 0);
	assert.strictEqual(
		indexFrameworkTree(db, 'Security', { interfaceLanguages: {} }),
		0,
	);
	assert.strictEqual(
		indexFrameworkTree(db, 'Security', {
			interfaceLanguages: { swift: [], occ: [] },
		}),
		0,
	);
	db.close();
});

test('indexFrameworkTree walks deeper children in occ tree even when parent path was already indexed in swift tree', () => {
	const db = new AppleDocsDB(':memory:');
	const indexData = {
		interfaceLanguages: {
			swift: [
				{
					title: 'Security',
					path: '/documentation/security',
					type: 'module',
					children: [
						{
							title: 'SecCertificate',
							path: '/documentation/security/seccertificate',
							type: 'struct',
						},
					],
				},
			],
			occ: [
				{
					title: 'Security',
					path: '/documentation/security',
					type: 'module',
					children: [
						{
							title: 'SecCertificateRef',
							path: '/documentation/security/seccertificate',
							type: 'struct',
							children: [
								{
									title: 'SecCertificateCopyData',
									path: '/documentation/security/seccertificatecopydata',
									type: 'func',
								},
							],
						},
					],
				},
			],
		},
	};

	const count = indexFrameworkTree(db, 'Security', indexData);
	assert.strictEqual(count, 3);

	const parent = db.getSymbolByPath('/documentation/security/seccertificate');
	assert.ok(parent);
	assert.strictEqual(parent.title, 'SecCertificate');

	const child = db.getSymbolByPath(
		'/documentation/security/seccertificatecopydata',
	);
	assert.ok(child, 'Deeper child in occ tree should be indexed');
	assert.strictEqual(child.title, 'SecCertificateCopyData');

	db.close();
});

test('indexFrameworkTree handles circular child references gracefully without stack overflow', () => {
	const db = new AppleDocsDB(':memory:');
	const nodeA = {
		title: 'Security',
		path: '/documentation/security',
		type: 'module',
		children: [],
	};
	const nodeB = {
		title: 'SecKey',
		path: '/documentation/security/seckey',
		type: 'struct',
		children: [nodeA],
	};
	nodeA.children.push(nodeB);

	const cyclicData = {
		interfaceLanguages: {
			swift: [nodeA],
		},
	};

	assert.doesNotThrow(() => {
		const count = indexFrameworkTree(db, 'Security', cyclicData);
		assert.strictEqual(count, 2);
	});

	db.close();
});

test('indexFrameworkTree indexes other interface language keys such as c or objc', () => {
	const db = new AppleDocsDB(':memory:');
	const cData = {
		interfaceLanguages: {
			c: [
				{
					title: 'Darwin',
					path: '/documentation/darwin',
					type: 'module',
					children: [
						{
							title: 'mach_task_self',
							path: '/documentation/darwin/mach_task_self',
							type: 'func',
						},
					],
				},
			],
		},
	};

	const count = indexFrameworkTree(db, 'Darwin', cData);
	assert.strictEqual(count, 2);

	const sym = db.getSymbolByPath('/documentation/darwin/mach_task_self');
	assert.ok(sym);
	assert.strictEqual(sym.title, 'mach_task_self');

	db.close();
});

test('indexFrameworkTree applies target framework default platforms when defaultPlatforms is omitted', () => {
	const db = new AppleDocsDB(':memory:');
	const crossData = {
		interfaceLanguages: {
			swift: [
				{
					title: 'SwiftUI',
					path: '/documentation/swiftui',
					type: 'module',
					children: [
						{
							title: 'NSView',
							path: '/documentation/appkit/nsview',
							type: 'class',
						},
					],
				},
			],
		},
	};

	const count = indexFrameworkTree(db, 'SwiftUI', crossData);
	assert.strictEqual(count, 2);

	const nsView = db.getSymbolByPath('/documentation/appkit/nsview');
	assert.ok(nsView);
	assert.strictEqual(nsView.framework, 'AppKit');
	assert.deepStrictEqual(nsView.platforms, ['macOS']);

	db.close();
});

test('indexFrameworkTree normalizes doc:// bundle paths in tree nodes', () => {
	const db = new AppleDocsDB(':memory:');
	const doccData = {
		interfaceLanguages: {
			swift: [
				{
					title: 'Security',
					path: 'doc://com.apple.Security/documentation/security',
					type: 'module',
					children: [
						{
							title: 'SecItemAdd(_:_:)',
							path: 'doc://com.apple.Security/documentation/security/secitemadd',
							type: 'func',
						},
					],
				},
			],
		},
	};

	const count = indexFrameworkTree(db, 'Security', doccData);
	assert.strictEqual(count, 2);

	const sec = db.getSymbolByPath('/documentation/security/secitemadd');
	assert.ok(
		sec,
		'Symbol should be retrievable by standard /documentation/ path',
	);
	assert.strictEqual(sec.path, '/documentation/security/secitemadd');
	assert.strictEqual(sec.id, '/documentation/security/secitemadd');

	db.close();
});

test('indexFrameworkTree deduplicates paths case-insensitively across swift and occ trees', () => {
	const db = new AppleDocsDB(':memory:');
	const mockData = {
		interfaceLanguages: {
			swift: [
				{
					title: 'Security',
					path: '/documentation/Security',
					type: 'module',
					children: [
						{
							title: 'SecItemAdd(_:_:)',
							path: '/documentation/Security/SecItemAdd',
							type: 'func',
						},
					],
				},
			],
			occ: [
				{
					title: 'Security',
					path: '/documentation/security',
					type: 'module',
					children: [
						{
							title: 'SecItemAdd',
							path: '/documentation/security/secitemadd',
							type: 'func',
						},
					],
				},
			],
		},
	};

	const count = indexFrameworkTree(db, 'Security', mockData);
	assert.strictEqual(
		count,
		2,
		'Should not insert duplicate rows differing only by case',
	);

	const sym = db.getSymbolByPath('/documentation/security/secitemadd');
	assert.ok(sym);
	assert.strictEqual(sym.title, 'SecItemAdd(_:_:)');

	db.close();
});
