import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AppleDocsDB } from '../../dist/server/db/database.js';
import {
	findDoccArchives,
	indexXcodeDocs,
	inspectDoccArchive,
} from '../../dist/server/services/xcode-indexer.js';
import { runXcodeIndexerCli } from '../../dist/cli/commands/xcode-indexer.js';

function createMockDoccArchive(rootDir, frameworkName) {
	const archiveDir = join(rootDir, `${frameworkName}.doccarchive`);
	mkdirSync(archiveDir, { recursive: true });

	// 1. metadata.json
	writeFileSync(
		join(archiveDir, 'metadata.json'),
		JSON.stringify({
			bundleDisplayName: frameworkName,
			bundleIdentifier: `com.apple.${frameworkName}`,
			schemaVersion: { major: 0, minor: 1, patch: 0 },
		}),
		'utf-8',
	);

	// 2. data/index/index.json
	const indexDir = join(archiveDir, 'data', 'index');
	mkdirSync(indexDir, { recursive: true });
	writeFileSync(
		join(indexDir, 'index.json'),
		JSON.stringify({
			interfaceLanguages: {
				swift: [
					{
						title: frameworkName,
						type: 'module',
						path: `/documentation/${frameworkName.toLowerCase()}`,
						children: [
							{
								title: `${frameworkName}View`,
								type: 'struct',
								path: `/documentation/${frameworkName.toLowerCase()}/${frameworkName.toLowerCase()}view`,
							},
						],
					},
				],
			},
		}),
		'utf-8',
	);

	// 3. data/documentation page JSON
	const docDir = join(
		archiveDir,
		'data',
		'documentation',
		frameworkName.toLowerCase(),
	);
	mkdirSync(docDir, { recursive: true });
	writeFileSync(
		join(docDir, `${frameworkName.toLowerCase()}view.json`),
		JSON.stringify({
			metadata: {
				title: `${frameworkName}View`,
				roleHeading: 'Structure',
				symbolKind: 'struct',
				platforms: [{ name: 'iOS', introducedAt: '17.0' }],
			},
			abstract: [
				{
					type: 'text',
					text: `A sample view in ${frameworkName}.`,
				},
			],
			references: {
				[`/documentation/${frameworkName.toLowerCase()}/${frameworkName.toLowerCase()}view/body`]:
					{
						title: 'body',
						roleHeading: 'Instance Property',
						symbolKind: 'property',
						url: `/documentation/${frameworkName.toLowerCase()}/${frameworkName.toLowerCase()}view/body`,
					},
			},
		}),
		'utf-8',
	);

	return archiveDir;
}

test('findDoccArchives and inspectDoccArchive identify local archives', () => {
	const dir = mkdtempSync(join(tmpdir(), 'xcode-inspect-'));

	try {
		const sub1 = join(dir, 'DerivedData', 'Build', 'Products');
		mkdirSync(sub1, { recursive: true });
		const archPath = createMockDoccArchive(sub1, 'CustomKit');

		const found = findDoccArchives(dir);
		assert.strictEqual(found.length, 1);
		assert.strictEqual(found[0], archPath);

		const inspected = inspectDoccArchive(archPath);
		assert.strictEqual(inspected.framework, 'CustomKit');
		assert.strictEqual(inspected.hasIndexTree, true);
		assert.strictEqual(inspected.documentationFilesCount, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('indexXcodeDocs parses doccarchive and indexes symbols into SQLite', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'xcode-index-test-'));
	const dbPath = join(dir, 'xcode-target.db');

	try {
		const archiveDir = createMockDoccArchive(dir, 'MockFramework');

		let progressCalled = false;
		const result = await indexXcodeDocs({
			dbPath,
			paths: [archiveDir],
			onProgress: (p) => {
				progressCalled = true;
				assert.strictEqual(p.archive, 'MockFramework.doccarchive');
			},
		});

		assert.strictEqual(result.archivesIndexed, 1);
		assert.ok(result.symbolsIndexed >= 2);
		assert.strictEqual(progressCalled, true);

		// Verify database contents
		const db = new AppleDocsDB(dbPath);
		assert.ok(db.getSymbolCount() >= 2);
		assert.strictEqual(db.getMeta('xcode_archives_indexed'), '1');
		assert.ok(db.getMeta('xcode_indexed_at'));

		// Query FTS
		const ftsHits = db.queryFTS('MockFrameworkView');
		assert.ok(ftsHits.length >= 1);
		assert.strictEqual(ftsHits[0].title, 'MockFrameworkView');

		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('runXcodeIndexerCli supports --dry-run and --json modes', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'xcode-cli-test-'));
	const dbPath = join(dir, 'cli-test.db');
	const archiveDir = createMockDoccArchive(dir, 'CliKit');

	try {
		let stdout = '';
		let stderr = '';

		const exitCode = await runXcodeIndexerCli({
			argv: ['--path', archiveDir, '--db', dbPath, '--dry-run', '--json'],
			print: (txt) => {
				stdout += txt;
			},
			eprint: (txt) => {
				stderr += txt;
			},
		});

		assert.strictEqual(exitCode, 0);
		const json = JSON.parse(stdout);
		assert.strictEqual(json.ok, true);
		assert.strictEqual(json.data.dryRun, true);
		assert.strictEqual(json.data.archivesFound.length, 1);
		assert.strictEqual(json.data.archivesFound[0].framework, 'CliKit');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('resolveXcodeSearchPaths returns array of paths and does not throw', async () => {
	const { resolveXcodeSearchPaths } =
		await import('../../dist/server/services/xcode-indexer.js');
	const paths = resolveXcodeSearchPaths();
	assert.ok(Array.isArray(paths));
});

test('indexXcodeDocs indexes standalone page symbol when references is empty', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'xcode-standalone-'));
	const dbPath = join(dir, 'standalone.db');
	const archiveDir = join(dir, 'StandaloneKit.doccarchive');
	mkdirSync(archiveDir, { recursive: true });

	writeFileSync(
		join(archiveDir, 'metadata.json'),
		JSON.stringify({
			bundleDisplayName: 'StandaloneKit',
			bundleIdentifier: 'com.apple.StandaloneKit',
		}),
		'utf-8',
	);

	// Page with NO references object, only root metadata and abstract
	const docDir = join(archiveDir, 'data', 'documentation', 'standalonekit');
	mkdirSync(docDir, { recursive: true });
	writeFileSync(
		join(docDir, 'widget.json'),
		JSON.stringify({
			identifier: {
				url: 'doc://com.apple.StandaloneKit/documentation/standalonekit/widget',
			},
			metadata: {
				title: 'Widget',
				roleHeading: 'Structure',
				symbolKind: 'struct',
				platforms: [{ name: 'iOS', introducedAt: '17.0' }],
			},
			abstract: [{ type: 'text', text: 'A standalone widget structure.' }],
			// No references field at all
		}),
		'utf-8',
	);

	try {
		const result = await indexXcodeDocs({
			dbPath,
			paths: [archiveDir],
		});

		assert.strictEqual(result.archivesIndexed, 1);
		assert.strictEqual(result.symbolsIndexed, 1);

		const db = new AppleDocsDB(dbPath);
		assert.strictEqual(db.getSymbolCount(), 1);
		const ftsHits = db.queryFTS('Widget');
		assert.strictEqual(ftsHits.length, 1);
		assert.strictEqual(ftsHits[0].title, 'Widget');
		assert.strictEqual(ftsHits[0].kind, 'struct');
		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
