# Specification: NPM Zero-Clone Distribution & Release Automation

**Feature:** NPM Hosting, Zero-Clone Execution, Portable Installer, and Automated Releases for `apple-doc-plugin`.

## 1. Context & Motivation

Currently, users must clone `https://github.com/AndrewMason7/apple-doc-plugin`, install dependencies, run `npm run build`, and configure hardcoded local filesystem paths in their MCP clients (`claude_desktop_config.json`, `cursor`, etc.). This creates high friction for adoption.

Hosting `apple-doc-plugin` on npm will allow:

1. Zero-clone execution via `npx -y apple-doc-plugin` in any MCP host.
2. Single-command configuration via `npx apple-doc-plugin install --target <target>`.
3. Seamless updates through standard npm versioning.

## 2. Functional Requirements

### FR-1: Package Manifest & Bundle Constraints

- Package name: `apple-doc-plugin`
- Access: Public
- Tarball size floor & ceiling: Must be < 15 MB (target: ~8.9 MB with gzipped SQLite DB).
- `package.json` must declare:
  - `bin`: `{"apple-doc-plugin": "dist/index.js"}`
  - `files`: allowlist including `dist/`, `data/apple-docs.db`, `bin/`, `skills/`, `rules/`, `plugin.json`, `plugin.yaml`, `bridges/`, `README.md`, `LICENSE`.
  - `prepublishOnly`: executes `npm run check && npm test` to prevent broken releases.
- Must execute correctly with Node.js >= 22 on macOS, Linux, and Windows.

### FR-2: Portable Installer NPX Mode

- `src/server/services/installer.ts` must support an installation `mode`:
  - `'npx'` (default when running via npx or global npm CLI): writes `command: "npx"`, `args: ["-y", "apple-doc-plugin"]`.
  - `'local'`: writes `command: "node"`, `args: ["<absolute-path>/bin/launcher.cjs"]`.
- `src/cli/commands/install.ts` must expose `--npx` and `--local` CLI flags.
- Auto-detection: When neither `--npx` nor `--local` is specified, the CLI auto-detects if it is executing from inside an npm cache or node_modules path and defaults to `'npx'`. If running inside a git repository source tree, defaults to `'npx'` unless `--local` is requested, ensuring configurations written to IDEs are resilient and portable across environments.

### FR-3: Release Automation

- `.github/workflows/publish.yml`:
  - Triggers on GitHub release publication or tag push matching `v*.*.*`.
  - Also supports manual dispatch (`workflow_dispatch`).
  - Runs full verification: `npm ci`, `npm run check`, `npm test`.
  - Publishes to npm using `npm publish --access public --provenance`.
  - Requires `NPM_TOKEN` secret in GitHub repository settings.

### FR-4: Documentation & Agent Guidelines

- Update `README.md`:
  - Elevate `npx -y apple-doc-plugin` and `npx apple-doc-plugin install --target <target>` to the primary Quick Start section.
  - Demote manual git cloning and local building to an "Advanced / Contributing" section.
- Synchronize `skills/apple-docs/SKILL.md` and `rules/AGENTS.md` to reference the npm package setup.

## 3. Non-Functional Requirements

- Zero regressions in existing 372 JS tests and 8 Python tests.
- Database integrity: `data/apple-docs.db` (95,899 symbols) must be bundled intact in the npm tarball.
- All code must pass `prettier --check .` and `tsc --noEmit`.
