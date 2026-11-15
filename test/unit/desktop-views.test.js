import test from 'node:test';
import assert from 'node:assert/strict';
import './mock-sdk-loader.js';

test('views, panes, and statusbar chip export valid React components and helpers', async () => {
	const { AppleDocsStudioPage } =
		await import('../../desktop/src/views/studio/AppleDocsStudioPage.js');
	const { AppleDocsSidePane, AppleDocsQuickPane } =
		await import('../../desktop/src/views/panes/AppleDocsSidePane.js');
	const { AppleDocsCompilerPane } =
		await import('../../desktop/src/views/panes/AppleDocsCompilerPane.js');
	const { AppleDocsStatusChip, formatCompactCount } =
		await import('../../desktop/src/views/status/AppleDocsStatusChip.js');

	assert.equal(typeof AppleDocsStudioPage, 'function');
	assert.equal(typeof AppleDocsSidePane, 'function');
	assert.equal(typeof AppleDocsQuickPane, 'function');
	assert.equal(typeof AppleDocsCompilerPane, 'function');
	assert.equal(typeof AppleDocsStatusChip, 'function');

	assert.equal(formatCompactCount(95899), '95.9k');
	assert.equal(formatCompactCount(500), '500');

	// Render studio page
	const studioEl = AppleDocsStudioPage({ ctx: {} });
	assert.ok(studioEl && studioEl.props);

	// Render side pane
	const sideEl = AppleDocsSidePane({ ctx: {} });
	assert.ok(sideEl && sideEl.props);

	// Render compiler pane
	const compilerEl = AppleDocsCompilerPane({ ctx: {} });
	assert.ok(compilerEl && compilerEl.props);

	// Render status chip
	const statusEl = AppleDocsStatusChip({ ctx: {} });
	assert.ok(statusEl && statusEl.props);
});
