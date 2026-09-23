import assert from 'node:assert';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('.env.example exists and documents environment variables', () => {
  const examplePath = join(process.cwd(), '.env.example');
  assert(existsSync(examplePath), '.env.example must exist in repository');

  const content = readFileSync(examplePath, 'utf8');
  assert(content.includes('GEMINI_API_KEY='), '.env.example must document GEMINI_API_KEY');
  assert(content.includes('APPLE_DOCS_DB_PATH='), '.env.example must document APPLE_DOCS_DB_PATH');
});

test('.env is ignored by git', () => {
  const gitignorePath = join(process.cwd(), '.gitignore');
  const gitignore = readFileSync(gitignorePath, 'utf8');
  assert(gitignore.includes('.env\n'), '.gitignore must ignore .env');
  assert(gitignore.includes('!.env.example\n'), '.gitignore must explicitly whitelist .env.example');
});
