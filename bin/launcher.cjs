#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const pluginRoot = path.resolve(__dirname, '..');
const nodeModules = path.join(pluginRoot, 'node_modules');
const distIndex = path.join(pluginRoot, 'dist', 'index.js');

// npm registry tarballs do not ship package-lock.json, so `npm ci` (lockfile-only)
// would hard-fail there. Use it when the lockfile exists (git clones — the
// reproducible path), and fall back to `npm install` for tarball installs.
const installCmd = fs.existsSync(path.join(pluginRoot, 'package-lock.json'))
	? 'npm ci'
	: 'npm install';

// npm child processes (install/build/rebuild) execute third-party lifecycle
// scripts (e.g. native postinstall downloaders). They must never see this
// process's injected credentials — strip the Hermes secret_scope key and any
// Google ADC/credential variables before handing the environment to npm.
const SCRUBBED_ENV_KEYS = [
	'GEMINI_API_KEY',
	'GOOGLE_API_KEY',
	'GOOGLE_APPLICATION_CREDENTIALS',
	'GOOGLE_CLOUD_PROJECT',
	'GOOGLE_CLOUD_CREDENTIALS',
	'CLOUDSDK_CONFIG',
	'APPLE_DOCS_GEMINI_API_KEY',
];

function buildChildEnv() {
	const env = { ...process.env };
	for (const key of SCRUBBED_ENV_KEYS) {
		delete env[key];
	}
	return env;
}

// Auto-bootstrap dependencies if missing (e.g. fresh clone or remote plugin install).
// Development dependencies are required here: `npm run build` runs `tsc`, and
// `--omit=dev` leaves TypeScript and @types/node out, so the build emits a wall
// of TS2580/TS2307 errors (it still emits JS, but the noise hides real ones).
if (!fs.existsSync(nodeModules)) {
	try {
		process.stderr.write(
			`[apple-doc-plugin] Installing dependencies (${installCmd})...\n`,
		);
		execSync(`${installCmd} --no-audit --no-fund`, {
			cwd: pluginRoot,
			stdio: ['ignore', 'ignore', 'inherit'],
			env: buildChildEnv(),
		});
	} catch (err) {
		process.stderr.write(
			`[apple-doc-plugin] Failed to auto-install dependencies: ${err.message}\n`,
		);
	}
}

// Auto-build if dist is missing
if (!fs.existsSync(distIndex)) {
	try {
		process.stderr.write('[apple-doc-plugin] Building project...\n');
		execSync('npm run build', {
			cwd: pluginRoot,
			stdio: ['ignore', 'ignore', 'inherit'],
			env: buildChildEnv(),
		});
	} catch (err) {
		process.stderr.write(
			`[apple-doc-plugin] Failed to build dist/index.js: ${err.message}\n`,
		);
	}
}

// Verify better-sqlite3 native bindings integrity
try {
	require('better-sqlite3');
} catch (nativeErr) {
	const msg = nativeErr?.message || '';
	if (
		msg.includes('bindings') ||
		msg.includes('NODE_MODULE_VERSION') ||
		msg.includes('invalid ELF header') ||
		msg.includes('mach-o file')
	) {
		try {
			process.stderr.write(
				'[apple-doc-plugin] Native better-sqlite3 binding mismatch; rebuilding...\n',
			);
			execSync('npm rebuild better-sqlite3', {
				cwd: pluginRoot,
				stdio: ['ignore', 'ignore', 'inherit'],
				env: buildChildEnv(),
			});
		} catch (rebuildErr) {
			process.stderr.write(
				'[apple-doc-plugin] Warning: Native sqlite rebuild deferred. Server will continue in dynamic DocC CDN fallback mode.\n',
			);
		}
	}
}

// Sanitize environment variables if literal template strings were passed
if (
	process.env.APPLE_DOCS_DB_PATH &&
	process.env.APPLE_DOCS_DB_PATH.includes('${extensionPath}')
) {
	process.env.APPLE_DOCS_DB_PATH = process.env.APPLE_DOCS_DB_PATH.replace(
		/\$\{extensionPath\}/g,
		pluginRoot,
	);
}

// Launch the MCP server
import(pathToFileURL(distIndex).href).catch((err) => {
	process.stderr.write(
		`[apple-doc-plugin] Failed to start MCP server: ${err.stack || err}\n`,
	);
	process.exit(1);
});
