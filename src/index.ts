#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server/app.js';

// Load .env file natively if available (checking project root, then cwd)
if (typeof process.loadEnvFile === 'function') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectEnv = join(__dirname, '../.env');
  try {
    if (existsSync(projectEnv)) {
      process.loadEnvFile(projectEnv);
    } else {
      process.loadEnvFile();
    }
  } catch {}
}

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Apple Developer Documentation MCP server running on stdio');
