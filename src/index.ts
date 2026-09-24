#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server/app.js';

import { loadEnvironment } from './server/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectEnv = join(__dirname, '../.env');
loadEnvironment(projectEnv);

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Apple Developer Documentation MCP server running on stdio');
