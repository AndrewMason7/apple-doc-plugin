#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server/app.js';
import { loadEnvironment } from './server/env.js';
import { logger } from './server/logger.js';
import { runCliRouter } from './cli/router.js';

// Attach process lifecycle safety guards to keep MCP stdio stream alive
process.on('uncaughtException', (err: Error) => {
	logger.error('CRITICAL: Uncaught exception in process:', err);
});

process.on('unhandledRejection', (reason: unknown) => {
	logger.error('WARNING: Unhandled promise rejection in process:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectEnv = join(__dirname, '../.env');
loadEnvironment(projectEnv);

async function main() {
	const args = process.argv.slice(2);
	const exitCode = await runCliRouter(args);
	if (exitCode !== null) {
		process.exit(exitCode);
	}

	// Default: Launch MCP stdio server
	const server = createServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	logger.info('Apple Developer Documentation MCP server running on stdio');
}

main().catch((err) => {
	logger.error('Fatal launcher error:', err);
	process.exit(1);
});
