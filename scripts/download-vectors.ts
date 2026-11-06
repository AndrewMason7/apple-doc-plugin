#!/usr/bin/env tsx

import { runDownloadVectorsCli } from '../src/cli/commands/download-vectors.js';

const code = await runDownloadVectorsCli({
	argv: process.argv.slice(2),
	print: (text) => process.stdout.write(text),
	eprint: (text) => process.stderr.write(text),
});

process.exitCode = code;
