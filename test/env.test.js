import assert from 'node:assert';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('.env.example exists and documents environment variables', () => {
	const examplePath = join(process.cwd(), '.env.example');
	assert(existsSync(examplePath), '.env.example must exist in repository');

	const content = readFileSync(examplePath, 'utf8');
	assert(
		content.includes('GEMINI_API_KEY='),
		'.env.example must document GEMINI_API_KEY',
	);
	assert(
		content.includes('GOOGLE_APPLICATION_CREDENTIALS='),
		'.env.example must document GOOGLE_APPLICATION_CREDENTIALS',
	);
	assert(
		content.includes('APPLE_DOCS_DB_PATH='),
		'.env.example must document APPLE_DOCS_DB_PATH',
	);
});

test('.env is ignored by git', () => {
	const gitignorePath = join(process.cwd(), '.gitignore');
	const gitignore = readFileSync(gitignorePath, 'utf8');
	assert(gitignore.includes('.env\n'), '.gitignore must ignore .env');
	assert(
		gitignore.includes('!.env.example\n'),
		'.gitignore must explicitly whitelist .env.example',
	);
});

test('loadEnvironment logs offline message when .env is missing and does not throw', async () => {
	const { loadEnvironment } = await import('../dist/server/env.js');
	const logs = [];
	const res = loadEnvironment('/path/to/definitely/missing/.env', (msg) => {
		logs.push(msg);
	});
	assert.strictEqual(res.loaded, false);
	assert.ok(
		logs.some((l) => l.includes('No .env found; running offline SQLite mode')),
	);
});

test('loadEnvironment loads valid .env without logging secrets', async () => {
	const { loadEnvironment } = await import('../dist/server/env.js');
	const { writeFileSync, unlinkSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const tmpEnv = join(tmpdir(), `test-env-${Date.now()}.env`);
	const secretVal = 'secret-test-key-xyz123';
	writeFileSync(tmpEnv, `TEST_CUSTOM_VAR=${secretVal}\n`);

	const logs = [];
	try {
		const res = loadEnvironment(tmpEnv, (msg) => {
			logs.push(msg);
		});
		assert.strictEqual(res.loaded, true);
		assert.strictEqual(process.env.TEST_CUSTOM_VAR, secretVal);
		assert.ok(
			!logs.some((l) => l.includes(secretVal)),
			'Must never leak secret values in logs',
		);
	} finally {
		try {
			unlinkSync(tmpEnv);
			delete process.env.TEST_CUSTOM_VAR;
		} catch {}
	}
});
