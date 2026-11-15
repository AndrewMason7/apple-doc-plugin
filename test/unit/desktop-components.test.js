import test from 'node:test';
import assert from 'node:assert/strict';
import './mock-sdk-loader.js';

test('components and hooks export valid React functions', async () => {
	const { useDebouncedValue } =
		await import('../../desktop/src/hooks/useDebouncedValue.js');
	const { GlyphSpinner } =
		await import('../../desktop/src/components/GlyphSpinner.js');
	const { SymbolInspectorDetail } =
		await import('../../desktop/src/components/SymbolInspectorDetail.js');
	const { InlineAppleDocCard } =
		await import('../../desktop/src/components/InlineAppleDocCard.js');

	assert.equal(typeof useDebouncedValue, 'function');
	assert.equal(typeof GlyphSpinner, 'function');
	assert.equal(typeof SymbolInspectorDetail, 'function');
	assert.equal(typeof InlineAppleDocCard, 'function');

	// Render empty GlyphSpinner
	const spinner = GlyphSpinner({});
	assert.ok(spinner && spinner.type);

	// Render empty SymbolInspectorDetail (empty state message)
	const emptyDetail = SymbolInspectorDetail({ ctx: {}, item: null });
	assert.ok(emptyDetail && emptyDetail.props && emptyDetail.props.children);

	// Render InlineAppleDocCard with various attribute forms
	const card = InlineAppleDocCard({
		ctx: {},
		attrs: {
			title: 'NavigationStack',
			framework: 'SwiftUI',
			platforms: ['iOS 16+'],
		},
	});
	assert.ok(card && card.props);

	// Render InlineAppleDocCard with malformed attrs (should not crash)
	const malformedCard = InlineAppleDocCard({
		ctx: {},
		attrs: { title: null, platforms: 'invalid,comma,separated' },
	});
	assert.ok(malformedCard && malformedCard.props);
});
