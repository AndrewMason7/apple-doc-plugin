import assert from 'node:assert';
import test from 'node:test';
import { extractMediaReferences } from '../dist/server/services/indexer.js';

test('extractMediaReferences correctly parses Apple image references and trait URLs', () => {
	const mockDocC = {
		references: {
			'sample-card.png': {
				type: 'image',
				alt: 'A screenshot showing iPad UI layout.',
				identifier: 'sample-card.png',
				variants: [
					{ traits: ['2x', 'light'], url: '/images/sample-card@2x.png' },
					{ traits: ['2x', 'dark'], url: '/images/sample-card~dark@2x.png' },
				],
			},
			'not-media': {
				type: 'symbol',
				title: 'View',
			},
		},
	};

	const media = extractMediaReferences(mockDocC);
	assert.strictEqual(media.length, 1);
	assert.strictEqual(media[0].identifier, 'sample-card.png');
	assert.strictEqual(media[0].alt, 'A screenshot showing iPad UI layout.');
	assert.strictEqual(
		media[0].url,
		'https://developer.apple.com/tutorials/images/sample-card@2x.png',
	);
	assert.strictEqual(media[0].mimeType, 'image/png');
});
