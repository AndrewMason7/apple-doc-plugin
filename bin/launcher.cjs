#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const pluginRoot = path.resolve(__dirname, '..');
const nodeModules = path.join(pluginRoot, 'node_modules');
const distIndex = path.join(pluginRoot, 'dist', 'index.js');

// Auto-bootstrap dependencies if missing (e.g. fresh clone or remote plugin install)
if (!fs.existsSync(nodeModules)) {
	try {
		process.stderr.write('[apple-doc-plugin] Installing dependencies...\n');
		execSync('npm install --omit=dev --no-audit --no-fund', {
			cwd: pluginRoot,
			stdio: ['ignore', 'ignore', 'inherit'],
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
		});
	} catch (err) {
		process.stderr.write(
			`[apple-doc-plugin] Failed to build dist/index.js: ${err.message}\n`,
		);
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
