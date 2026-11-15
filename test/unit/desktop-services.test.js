import test from 'node:test';
import assert from 'node:assert/strict';
import './mock-sdk-loader.js';

test('services layer handles search, fallbacks, and host bridge', async () => {
	const { localSearchFallback, localDiagnoseFallback, safeRest } =
		await import('../../desktop/src/services/search-service.js');
	const {
		safeHaptic,
		safeNavigate,
		safeOpenPane,
		safeNotify,
		safeWriteClipboard,
		safeOpenExternal,
	} = await import('../../desktop/src/services/host-bridge.js');

	const defaultResults = localSearchFallback('', '');
	assert.ok(defaultResults.results.length >= 8);
	assert.equal(defaultResults.mode, 'curated-preview');

	const matched = localSearchFallback('NavigationSplitView', 'SwiftUI');
	assert.ok(matched.results.length > 0);
	assert.equal(matched.results[0].title, 'NavigationSplitView');

	const zeroMatch = localSearchFallback('NonExistentXYZ12345', 'SwiftUI');
	assert.deepEqual(
		zeroMatch.results,
		[],
		'Must return honest empty array without substituting results',
	);

	const result = localDiagnoseFallback(
		"error: 'NavigationView' is deprecated in iOS 16.0",
	);
	assert.equal(result.matched, true);
	assert.ok(result.findings.length > 0);
	assert.equal(result.findings[0].symbol, 'NavigationView');
	assert.ok(result.findings[0].replacement.includes('NavigationStack'));

	await assert.rejects(
		async () => await safeRest(null, '/test'),
		/ctx\.rest unavailable/,
	);

	assert.doesNotThrow(() => safeHaptic('tap'));
	assert.doesNotThrow(() => safeNavigate('/apple-docs'));
	assert.equal(safeOpenPane('inspector-pane'), true);
	assert.doesNotThrow(() => safeNotify('test', 'info'));
	assert.equal(await safeWriteClipboard(null, 'hello'), false);
	assert.equal(safeOpenExternal(null, 'https://developer.apple.com'), false);
});
