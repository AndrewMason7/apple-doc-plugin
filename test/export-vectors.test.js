import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AppleDocsDB } from '../dist/server/db/database.js';
import { exportVectors } from '../dist/server/services/export-vectors.js';

test('exportVectors exports 768-d vectors into a standalone SQLite bundle with manifest', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'export-vec-test-'));
	const sourceDbPath = join(dir, 'source.db');
	const outputDbPath = join(dir, 'exported-vectors.db');

	try {
		// 1. Create source database with items (both 768-d and other dimensions)
		const sourceDb = new AppleDocsDB(sourceDbPath);

		const vec768A = new Float32Array(768);
		vec768A[0] = 0.8;
		sourceDb.insertSemanticItem({
			id: 'doc/swiftui/button',
			framework: 'SwiftUI',
			title: 'Button',
			kind: 'struct',
			summary: 'A control that initiates an action.',
			path: '/documentation/swiftui/button',
			embedding: vec768A,
		});

		const vec768B = new Float32Array(768);
		vec768B[1] = 0.9;
		sourceDb.insertSemanticItem({
			id: 'doc/uikit/uibutton',
			framework: 'UIKit',
			title: 'UIButton',
			kind: 'class',
			summary: 'A button in UIKit.',
			path: '/documentation/uikit/uibutton',
			embedding: vec768B,
		});

		// Insert non-768 item that should NOT be exported when dimensions=768
		const vec128 = new Float32Array(128);
		sourceDb.insertSemanticItem({
			id: 'doc/other/item',
			framework: 'Other',
			title: 'OtherItem',
			kind: 'struct',
			summary: 'An item with 128-d vector.',
			path: '/documentation/other/item',
			embedding: vec128,
		});

		sourceDb.close();

		// 2. Run export
		let progressReported = false;
		const result = await exportVectors({
			sourceDbPath,
			outputPath: outputDbPath,
			dimensions: 768,
			writeManifest: true,
			onProgress: (p) => {
				progressReported = true;
				assert.ok(p.exported > 0);
			},
		});

		assert.strictEqual(result.totalVectors, 2);
		assert.ok(existsSync(outputDbPath));
		assert.ok(result.manifestPath && existsSync(result.manifestPath));
		assert.ok(result.sha256Path && existsSync(result.sha256Path));
		assert.strictEqual(progressReported, true);

		// 3. Inspect manifest file
		const manifestRaw = readFileSync(result.manifestPath, 'utf-8');
		const manifest = JSON.parse(manifestRaw);
		assert.strictEqual(manifest.totalVectors, 2);
		assert.strictEqual(manifest.dimensions, 768);
		assert.strictEqual(manifest.sha256, result.sha256);
		assert.deepStrictEqual(manifest.frameworks, ['SwiftUI', 'UIKit']);

		// 4. Inspect exported database
		const exportedDb = new AppleDocsDB(outputDbPath, { readonly: true });
		assert.strictEqual(exportedDb.getMeta('vector_count'), '2');
		assert.strictEqual(exportedDb.getMeta('vector_dimensions'), '768');
		const items = exportedDb.getSemanticItems();
		assert.strictEqual(items.length, 2);
		exportedDb.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('exportVectors honors framework filter and force flag', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'export-filter-test-'));
	const sourceDbPath = join(dir, 'source.db');
	const outputDbPath = join(dir, 'swiftui-vectors.db');

	try {
		const sourceDb = new AppleDocsDB(sourceDbPath);
		const vec = new Float32Array(768);

		sourceDb.insertSemanticItem({
			id: 'doc/swiftui/text',
			framework: 'SwiftUI',
			title: 'Text',
			kind: 'struct',
			summary: 'A view that displays text.',
			path: '/documentation/swiftui/text',
			embedding: vec,
		});

		sourceDb.insertSemanticItem({
			id: 'doc/uikit/uilabel',
			framework: 'UIKit',
			title: 'UILabel',
			kind: 'class',
			summary: 'A view in UIKit.',
			path: '/documentation/uikit/uilabel',
			embedding: vec,
		});
		sourceDb.close();

		// Export only SwiftUI
		const res = await exportVectors({
			sourceDbPath,
			outputPath: outputDbPath,
			framework: 'SwiftUI',
			dimensions: 768,
		});

		assert.strictEqual(res.totalVectors, 1);
		assert.deepStrictEqual(res.manifest.frameworks, ['SwiftUI']);

		// Attempting to export again without force should throw
		await assert.rejects(
			async () => {
				await exportVectors({
					sourceDbPath,
					outputPath: outputDbPath,
					force: false,
				});
			},
			{ message: /Target export file already exists/ },
		);

		// With force: true, it overwrites cleanly
		const forceRes = await exportVectors({
			sourceDbPath,
			outputPath: outputDbPath,
			force: true,
		});
		assert.strictEqual(forceRes.totalVectors, 2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
