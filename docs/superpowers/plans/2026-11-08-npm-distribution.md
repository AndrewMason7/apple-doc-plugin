# NPM Zero-Clone Distribution & Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable zero-clone execution of `apple-doc-plugin` via `npx -y apple-doc-plugin` and one-command automated IDE configuration, backed by automated GitHub Actions npm publishing.

**Architecture:** Package the precompiled TypeScript server and the 95,899-symbol SQLite database directly into an npm distribution under 15 MB. Extend the installer service to configure portable `npx` execution by default while preserving local path options, and automate releases via GitHub Actions.

**Tech Stack:** Node.js (>=22), npm, TypeScript 5.9, Better-SQLite3, GitHub Actions CI/CD.

**Spec:** `docs/superpowers/specs/2026-11-08-npm-distribution.md`

## Global Constraints

- Package name must be `apple-doc-plugin` with public access.
- Compressed npm tarball size must remain under 15 MB (target: ~8.9 MB).
- Database integrity: `data/apple-docs.db` (95,899 symbols) must be bundled intact and accessible at runtime.
- No regressions: all 372 JS tests and 8 Python tests must pass.
- Code style: zero TypeScript errors (`tsc --noEmit`), Prettier compliant (`prettier --check .`).

## Review Focus

1. Running `apple-doc-plugin install --target cursor` without arguments produces a portable `{"command": "npx", "args": ["-y", "apple-doc-plugin"]}` config rather than a brittle temporary cache path.
2. Running with `--local` retains the historical repository launcher path for local contributor development.
3. Running `npm pack --dry-run` excludes test files, local databases backups, and development scripts while keeping the production SQLite database and skill/rule files.
4. The executable entrypoint `dist/index.js` preserves the `#!/usr/bin/env node` shebang and execution permissions (`0755`).
5. Running `apple-doc-plugin install` on existing configuration files with comments or peer servers preserves existing settings without corruption.

---

### Task 1: Package Manifest, Files Allowlist, & Bundle Guard

**Files:**

- Modify: `package.json`
- Create: `test/cli/npm-pack.test.js`

**Interfaces:**

- Consumes: `package.json` manifest and npm packaging CLI.
- Produces: `prepublishOnly` guard, `files` allowlist, and automated tarball content/size verification test.

- [x] **Step 1: Write the failing test**

Create `test/cli/npm-pack.test.js`:

```javascript
import assert from 'node:assert';
import test from 'node:test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

test('npm pack: tarball bundle meets size ceiling and file allowlist', () => {
	const output = execSync('npm pack --dry-run --json', { encoding: 'utf8' });
	const [packInfo] = JSON.parse(output);

	assert.strictEqual(packInfo.name, 'apple-doc-plugin');
	assert.ok(
		packInfo.size < 15 * 1024 * 1024,
		`Tarball size ${packInfo.size} exceeds 15 MB limit`,
	);

	const filenames = packInfo.files.map((f) => f.path);

	// Required runtime files
	assert.ok(
		filenames.includes('data/apple-docs.db'),
		'Missing SQLite database',
	);
	assert.ok(filenames.includes('dist/index.js'), 'Missing entrypoint');
	assert.ok(
		filenames.includes('skills/apple-docs/SKILL.md'),
		'Missing skill definition',
	);
	assert.ok(filenames.includes('rules/AGENTS.md'), 'Missing rules definition');
	assert.ok(filenames.includes('LICENSE'), 'Missing LICENSE');
	assert.ok(filenames.includes('README.md'), 'Missing README.md');

	// Excluded development files
	assert.ok(
		!filenames.some((f) => f.startsWith('test/')),
		'Included test files',
	);
	assert.ok(
		!filenames.some((f) => f.endsWith('.bak')),
		'Included backup files',
	);
	assert.ok(!filenames.some((f) => f.includes('.env')), 'Included .env file');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/cli/npm-pack.test.js`
Expected: FAIL or PASS depending on current manifest state (fails if exclusions/package fields aren't strictly guarded).

- [x] **Step 3: Update `package.json` manifest and scripts**

Modify `package.json`:

- Add `"prepublishOnly": "npm run check && npm test"`
- Ensure `"files"` contains only:

  ```json
  "files": [
    "dist/",
    "data/apple-docs.db",
    "bin/",
    "plugin.json",
    "plugin.yaml",
    "bridges/",
    "mcp_config.json",
    "skills/",
    "rules/",
    "README.md",
    "LICENSE"
  ]
  ```

  (Exclude `scripts/` from tarball to keep package lean).

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/cli/npm-pack.test.js`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add package.json test/cli/npm-pack.test.js
git commit -m "feat(package): optimize npm packaging allowlist and add bundle guard test"
```

---

### Task 2: Installer Portable NPX Mode & Flag Support

**Files:**

- Modify: `src/server/services/installer.ts:18-350`
- Modify: `src/cli/commands/install.ts:18-120`
- Modify: `test/cli/installer.test.js:120-257`

**Interfaces:**

- Consumes: `InstallerTarget`, `InstallOptions`
- Produces: `InstallOptions.mode` (`'npx' | 'local'`), CLI flags `--npx` and `--local`, and portable MCP config generation.

- [x] **Step 1: Write the failing tests**

Add tests to `test/cli/installer.test.js`:

```javascript
test('installMcpServer: mode "npx" writes npx command and args', () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-install-'));
	const targetConfig = path.join(tempDir, 'mcp.json');

	const result = installMcpServer({
		target: 'cursor',
		configPath: targetConfig,
		mode: 'npx',
	});

	assert.strictEqual(result.serverConfig.command, 'npx');
	assert.deepStrictEqual(result.serverConfig.args, ['-y', 'apple-doc-plugin']);

	const saved = JSON.parse(fs.readFileSync(targetConfig, 'utf8'));
	assert.strictEqual(saved.mcpServers['apple-docs'].command, 'npx');
	assert.deepStrictEqual(saved.mcpServers['apple-docs'].args, [
		'-y',
		'apple-doc-plugin',
	]);
});

test('runInstallerCli: --local flag forces local launcher mode', async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-docs-install-'));
	const targetConfig = path.join(tempDir, 'mcp.json');
	let printed = '';

	const exitCode = await runInstallerCli({
		argv: ['--target', 'cursor', '--config-path', targetConfig, '--local'],
		print: (text) => {
			printed += text;
		},
	});

	assert.strictEqual(exitCode, 0);
	const saved = JSON.parse(fs.readFileSync(targetConfig, 'utf8'));
	assert.strictEqual(saved.mcpServers['apple-docs'].command, 'node');
	assert.ok(saved.mcpServers['apple-docs'].args[0].includes('launcher.cjs'));
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test test/cli/installer.test.js`
Expected: FAIL with `mode` not recognized or `result.serverConfig.command` expected `'npx'` but got `'node'`.

- [x] **Step 3: Implement NPX mode in `installer.ts` and `install.ts`**

1. In `src/server/services/installer.ts`:
   - Extend `InstallOptions`:

     ```typescript
     export type InstallMode = 'npx' | 'local';

     export interface InstallOptions {
     	// ... existing options
     	mode?: InstallMode;
     }
     ```

   - In `installMcpServer`:
     - Default `mode`: if not specified, default to `'npx'`.
     - When `mode === 'npx'`:
       ```typescript
       const command = options.command || 'npx';
       const args = options.args || ['-y', 'apple-doc-plugin'];
       ```
     - When `mode === 'local'`:
       ```typescript
       const command = options.command || 'node';
       const args = options.args || [defaultLauncher];
       ```

2. In `src/cli/commands/install.ts`:
   - Parse `--npx` and `--local`:
     ```typescript
     const isLocal = argv.includes('--local');
     const isNpx = argv.includes('--npx');
     const mode: InstallMode = isLocal ? 'local' : 'npx';
     ```
   - Update `USAGE` help text with `--npx` and `--local` documentation.

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test test/cli/installer.test.js`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/server/services/installer.ts src/cli/commands/install.ts test/cli/installer.test.js
git commit -m "feat(installer): support portable npx mode and --local override"
```

---

### Task 3: Automated GitHub Actions Publish Workflow

**Files:**

- Create: `.github/workflows/publish.yml`
- Create: `scripts/publish-dryrun.sh`

**Interfaces:**

- Consumes: GitHub tag events (`v*.*.*`) or manual trigger (`workflow_dispatch`).
- Produces: Validated, tested npm package publication with provenance.

- [x] **Step 1: Write `scripts/publish-dryrun.sh` and test locally**

Create `scripts/publish-dryrun.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Running format and type checks..."
npm run check

echo "==> Running test suite..."
npm test

echo "==> Running npm pack dry run..."
npm pack --dry-run

echo "==> Ready for publishing."
```

Make executable: `chmod +x scripts/publish-dryrun.sh`
Run: `./scripts/publish-dryrun.sh`
Expected: Exits 0 with successful pack output.

- [x] **Step 2: Create `.github/workflows/publish.yml`**

Create `.github/workflows/publish.yml`:

```yaml
name: Publish to NPM

on:
  release:
    types: [published]
  workflow_dispatch:

jobs:
  build-and-publish:
    runs-on: macos-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm ci

      - name: Lint and typecheck
        run: npm run check

      - name: Run test suite
        run: npm test

      - name: Publish to NPM
        run: npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [x] **Step 3: Run verify commands**

Run: `npx prettier --check .github/workflows/publish.yml scripts/publish-dryrun.sh`
Expected: PASS (or format with `npx prettier --write`).

- [x] **Step 4: Commit**

```bash
git add .github/workflows/publish.yml scripts/publish-dryrun.sh
git commit -m "ci: add GitHub Actions workflow for npm publishing with provenance"
```

---

### Task 4: Documentation & Agent Guidance Refresh

**Files:**

- Modify: `README.md`
- Modify: `skills/apple-docs/SKILL.md`
- Modify: `rules/AGENTS.md`

**Interfaces:**

- Consumes: New `npx` distribution model and installer commands.
- Produces: Updated, accurate user-facing docs across all IDEs and platforms.

- [x] **Step 1: Update `README.md`**

- Highlight Zero-Clone Setup at the top of Quick Start:
  ```json
  {
  	"mcpServers": {
  		"apple-docs": {
  			"command": "npx",
  			"args": ["-y", "apple-doc-plugin"]
  		}
  	}
  }
  ```
- Document One-Click CLI setup:
  ```bash
  npx apple-doc-plugin install --target cursor
  npx apple-doc-plugin install --target claude-desktop
  ```
- Move repository cloning and building to an "Advanced / Building From Source" section.

- [x] **Step 2: Update `skills/apple-docs/SKILL.md` and `rules/AGENTS.md`**

Ensure references to the CLI and installation reflect `apple-doc-plugin` / `npx apple-doc-plugin`.

- [x] **Step 3: Run full validation suite**

Run:

```bash
npm run check
npm test
npm run doctor
```

Expected: All 372 tests pass, 0 type errors, 0 format errors, doctor reports clean database.

- [x] **Step 4: Commit**

```bash
git add README.md skills/apple-docs/SKILL.md rules/AGENTS.md
git commit -m "docs: promote zero-clone npx installation as primary setup"
```

---

## Plan Review Checklist

1. **Spec coverage**:
   - FR-1 (Package & Bundle Guard): Task 1
   - FR-2 (Installer NPX Mode): Task 2
   - FR-3 (Release Automation): Task 3
   - FR-4 (Documentation Refresh): Task 4
2. **Step scan**: Every step has an explicit checkable command and expected output.
3. **Type consistency**: `InstallMode` (`'npx' | 'local'`) used consistently across `installer.ts`, `install.ts`, and test files.
4. **Review focus**: Covered in Task 1 (bundle guard), Task 2 (installer npx default and local override), Task 3 (provenance), Task 4 (docs).
5. **Proportion**: Bite-sized, precise tasks without transcript bloat.
