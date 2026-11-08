import {
	installMcpServer,
	resolveTargetConfigPath,
	type InstallerTarget,
	type InstallMode,
} from '../../server/services/installer.js';

export interface InstallerCliOptions {
	argv: string[];
	print: (text: string) => void;
	eprint?: (text: string) => void;
}

const USAGE = `Usage: apple-doc-plugin install --target <target> [options]

One-Click IDE / Agent Configuration CLI. Safely detects and updates
configuration files across platforms.

Options:
  -t, --target <name>      Target IDE or agent: cursor, claude-desktop, windsurf, antigravity, vscode
  --config-path <path>     Explicit configuration file path override
  --name <name>            Custom MCP server key name (default: "apple-docs")
  --npx                    Configure using portable npx command (default)
  --local                  Configure using repository launcher path
  --command <cmd>          Executable command override
  --args <args>            Space-separated command arguments (default: path to bin/launcher.cjs)
  --env <KEY=VALUE>        Environment variable to pass (can be repeated)
  --dry-run                Print the resolved path and config JSON without writing to disk
  --force                  Overwrite or ignore existing unparseable config
  --json                   Output result in machine-readable JSON format
  -h, --help               Show this help message

Examples:
  apple-doc-plugin install --target cursor
  apple-doc-plugin install --target claude-desktop
  apple-doc-plugin install --target windsurf
  apple-doc-plugin install --target antigravity
  apple-doc-plugin install --target cursor --dry-run
  apple-doc-plugin install --target cursor --env GEMINI_API_KEY=AIzaSy...
`;

export async function runInstallerCli(
	options: InstallerCliOptions,
): Promise<number> {
	const eprint = options.eprint ?? ((t: string) => process.stderr.write(t));
	const argv = options.argv;

	if (argv.includes('--help') || argv.includes('-h')) {
		options.print(USAGE);
		return 0;
	}

	let target: string | undefined;
	const targetIdx =
		argv.indexOf('--target') !== -1
			? argv.indexOf('--target')
			: argv.indexOf('-t');
	if (targetIdx !== -1 && targetIdx + 1 < argv.length) {
		target = argv[targetIdx + 1];
	}

	if (!target) {
		eprint(
			'Error: Missing required option "--target <target>".\nSupported targets: cursor, claude-desktop, windsurf, antigravity, vscode\n\n' +
				USAGE,
		);
		return 2;
	}

	const configPathIdx = argv.indexOf('--config-path');
	const configPath =
		configPathIdx !== -1 && configPathIdx + 1 < argv.length
			? argv[configPathIdx + 1]
			: undefined;

	const nameIdx = argv.indexOf('--name');
	const serverName =
		nameIdx !== -1 && nameIdx + 1 < argv.length ? argv[nameIdx + 1] : undefined;

	const cmdIdx = argv.indexOf('--command');
	const command =
		cmdIdx !== -1 && cmdIdx + 1 < argv.length ? argv[cmdIdx + 1] : undefined;

	const argsIdx = argv.indexOf('--args');
	const customArgs =
		argsIdx !== -1 && argsIdx + 1 < argv.length
			? argv[argsIdx + 1].split(' ')
			: undefined;

	const env: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--env' && i + 1 < argv.length) {
			const eqIdx = argv[i + 1].indexOf('=');
			if (eqIdx !== -1) {
				const k = argv[i + 1].slice(0, eqIdx).trim();
				const v = argv[i + 1].slice(eqIdx + 1).trim();
				if (k) env[k] = v;
			}
		}
	}

	const dryRun = argv.includes('--dry-run');
	const force = argv.includes('--force');
	const json = argv.includes('--json');
	const isLocal = argv.includes('--local');
	const mode: InstallMode = isLocal ? 'local' : 'npx';

	try {
		const result = installMcpServer({
			target: target as InstallerTarget,
			mode,
			configPath,
			serverName,
			command,
			args: customArgs,
			env: Object.keys(env).length > 0 ? env : undefined,
			dryRun,
			force,
		});

		if (json) {
			options.print(
				`${JSON.stringify(
					{
						ok: true,
						target: result.target,
						configPath: result.configPath,
						createdNew: result.createdNew,
						updatedExisting: result.updatedExisting,
						serverName: result.serverName,
						serverConfig: result.serverConfig,
						dryRun: result.dryRun,
						backupPath: result.backupPath,
					},
					null,
					2,
				)}\n`,
			);
			return 0;
		}

		if (result.dryRun) {
			options.print(
				`🔍 [Dry Run] Target configuration: ${result.configPath}\n` +
					`   Action: ${result.createdNew ? 'Create new file' : result.updatedExisting ? 'Update existing server' : 'Add server to existing config'}\n\n` +
					`Proposed configuration:\n${result.configJson}`,
			);
			return 0;
		}

		options.print(
			`✅ Successfully configured "${result.serverName}" for ${result.target}!\n` +
				`📁 Configuration file: ${result.configPath}\n` +
				(result.backupPath ? `💾 Backup created: ${result.backupPath}\n` : '') +
				`🚀 Command: ${result.serverConfig.command} ${result.serverConfig.args.join(' ')}\n` +
				`\nRestart your ${result.target} IDE or reload MCP servers to activate Apple Docs.\n`,
		);
		return 0;
	} catch (err) {
		eprint(
			`✖ Installer error: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return 1;
	}
}
