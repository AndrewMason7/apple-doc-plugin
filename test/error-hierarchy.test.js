import test from 'node:test';
import assert from 'node:assert/strict';
import {
	AppError,
	DatabaseError,
	AppleDocsNetworkError,
	CacheError,
	ValidationError,
} from '../dist/server/errors.js';
import { logger } from '../dist/server/logger.js';

test('Error Hierarchy: captures code, status, and isTransient attributes', () => {
	const netErr = new AppleDocsNetworkError('Gateway timeout', 504, true);
	assert.equal(netErr.code, 'NETWORK_ERROR');
	assert.equal(netErr.status, 504);
	assert.equal(netErr.isTransient, true);
	assert.equal(netErr instanceof AppError, true);
	assert.equal(netErr instanceof Error, true);

	const dbErr = new DatabaseError('Locked');
	assert.equal(dbErr.code, 'DATABASE_ERROR');
	assert.equal(dbErr instanceof AppError, true);

	const cacheErr = new CacheError('Corrupted JSON');
	assert.equal(cacheErr.code, 'CACHE_ERROR');
	assert.equal(cacheErr instanceof AppError, true);

	const valErr = new ValidationError('Invalid page parameter');
	assert.equal(valErr.code, 'VALIDATION_ERROR');
	assert.equal(valErr instanceof AppError, true);
});

test('Logger: logs to stderr and does not throw', () => {
	assert.doesNotThrow(() => {
		logger.debug('debug msg');
		logger.info('info msg');
		logger.warn('warn msg');
		logger.error('error msg');
	});
});
