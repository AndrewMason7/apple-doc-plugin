#!/usr/bin/env tsx

import { runDownloadModelCli } from '../src/cli/commands/download-model.js';

const code = await runDownloadModelCli({
	argv: process.argv.slice(2),
	print: (text) => process.stdout.write(text),
	eprint: (text) => process.stderr.write(text),
});

process.exitCode = code;
