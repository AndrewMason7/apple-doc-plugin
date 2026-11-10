import { safeEnsureRuntimeDbSeeded } from '../server/db/db-path.js';
import { logger } from '../server/logger.js';
import {
	UnavailableEmbeddingProvider,
	resolveEmbeddingProvider,
} from '../server/services/search/provider-factory.js';
import { runDoctorCli } from './commands/doctor.js';
import { runInstallerCli } from './commands/install.js';
import { runSetupCli } from './commands/setup.js';
import { runXcodeIndexerCli } from './commands/xcode-indexer.js';
import { runDownloadModelCli } from './commands/download-model.js';
import { runDownloadVectorsCli } from './commands/download-vectors.js';
import { runExportVectorsCli } from './commands/export-vectors.js';

export interface CliRouterIo {
	print?: (text: string) => void;
	eprint?: (text: string) => void;
}

export const USAGE = `Apple Developer Documentation MCP Server & Toolkit

Usage:
  apple-doc-plugin                       Launch the MCP server on stdio (default)
  apple-doc-plugin install --target <id> One-click IDE / Agent config (cursor, claude-desktop, windsurf, antigravity)
  apple-doc-plugin setup                 First-run setup and vector bootstrap
  apple-doc-plugin doctor [--json]       Check index health and embedding provider
  apple-doc-plugin download-vectors      Download pre-computed vector index for semantic search
  apple-doc-plugin download-model        Download local EmbeddingGemma GGUF model
  apple-doc-plugin export-vectors        Export vector bundle into verifiable SQLite package
  apple-doc-plugin index-xcode           Index local Xcode .doccarchive documentation offline
  apple-doc-plugin --help                Show this help message
`;

/**
 * Routes command-line arguments to the appropriate subcommand.
 * Returns process exit code, or null if the caller should start the MCP stdio server.
 */
export async function runCliRouter(
	args: string[],
	io?: CliRouterIo,
): Promise<number | null> {
	const print = io?.print ?? ((text: string) => process.stdout.write(text));
	const eprint = io?.eprint ?? ((text: string) => process.stderr.write(text));

	const command = args[0];

	if (command === '--help' || command === '-h' || command === 'help') {
		print(USAGE);
		return 0;
	}

	if (command === 'install') {
		return runInstallerCli({
			argv: args.slice(1),
			print,
			eprint,
		});
	}

	if (command === 'setup') {
		return runSetupCli({
			argv: args.slice(1),
			print,
			eprint,
		});
	}

	if (command === 'doctor') {
		const dbPath = safeEnsureRuntimeDbSeeded();
		let provider;
		try {
			provider = resolveEmbeddingProvider();
		} catch (err) {
			logger.warn('Could not initialise embedding provider for doctor:', err);
			provider = new UnavailableEmbeddingProvider();
		}

		return runDoctorCli({
			argv: args.slice(1),
			dbPath,
			provider,
			nodeVersion: process.version,
			print,
			eprint,
		});
	}

	if (command === 'download-model') {
		return runDownloadModelCli({
			argv: args.slice(1),
			print,
			eprint,
		});
	}

	if (command === 'download-vectors') {
		return runDownloadVectorsCli({
			argv: args.slice(1),
			print,
			eprint,
		});
	}

	if (command === 'export-vectors') {
		return runExportVectorsCli({
			argv: args.slice(1),
			print,
			eprint,
		});
	}

	if (command === 'index-xcode') {
		return runXcodeIndexerCli({
			argv: args.slice(1),
			print,
			eprint,
		});
	}

	if (command && command !== 'server') {
		eprint(`Unknown command or option: "${command}"\n\n${USAGE}`);
		return 2;
	}

	// null indicates running the MCP stdio server
	return null;
}
