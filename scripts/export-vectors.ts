#!/usr/bin/env node

import { runExportVectorsCli } from '../src/cli/commands/export-vectors.js';

const code = await runExportVectorsCli({
	argv: process.argv.slice(2),
	print: (text) => process.stdout.write(text),
	eprint: (text) => process.stderr.write(text),
});

process.exitCode = code;
