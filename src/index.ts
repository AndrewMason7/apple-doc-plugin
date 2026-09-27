#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server/app.js';
import { loadEnvironment } from './server/env.js';
import { logger } from './server/logger.js';

// Attach process lifecycle safety guards to keep MCP stdio stream alive
process.on('uncaughtException', (err: Error) => {
	logger.error('CRITICAL: Uncaught exception in MCP server process:', err);
});

process.on('unhandledRejection', (reason: unknown) => {
	logger.error(
		'WARNING: Unhandled promise rejection in MCP server process:',
		reason,
	);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectEnv = join(__dirname, '../.env');
loadEnvironment(projectEnv);

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('Apple Developer Documentation MCP server running on stdio');
