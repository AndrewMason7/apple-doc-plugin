import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type InstallerTarget =
	| 'cursor'
	| 'claude-desktop'
	| 'claude'
	| 'windsurf'
	| 'antigravity'
	| 'vscode';

export interface InstallServerConfig {
	command: string;
	args: string[];
	env?: Record<string, string>;
}

export interface InstallOptions {
	/** Target IDE / Agent */
	target: InstallerTarget | string;
	/** Custom config destination override */
	configPath?: string;
	/** Name of the MCP server key in mcpServers object (defaults to "apple-docs") */
	serverName?: string;
	/** Command to run (defaults to "node") */
	command?: string;
	/** Arguments for command (defaults to absolute path to bin/launcher.cjs) */
	args?: string[];
	/** Environment variables to pass to the MCP server */
	env?: Record<string, string>;
	/** Dry run mode: do not write to disk */
	dryRun?: boolean;
	/** Force overwrite without creating backup */
	force?: boolean;
	/** Injectable user home directory (for testing / multi-platform) */
	homeDir?: string;
	/** Injectable APPDATA directory (for Windows testing) */
	appData?: string;
	/** Injectable platform override (for testing) */
	platform?: NodeJS.Platform;
}

export interface InstallResult {
	target: string;
	configPath: string;
	createdNew: boolean;
	updatedExisting: boolean;
	serverName: string;
	serverConfig: InstallServerConfig;
	dryRun: boolean;
	backupPath?: string;
	configJson: string;
}

/**
 * Returns the absolute path to the repository root directory.
 */
export function getProjectRoot(): string {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	// src/server/services/installer.ts -> ../../../
	return resolve(__dirname, '../../../');
}

/**
 * Strips JSON comments and trailing commas to be forgiving of user configs.
 * Safely preserves string literals (including URLs like https://... and paths).
 */
export function cleanJsonComments(raw: string): string {
	let inString = false;
	let inSingleComment = false;
	let inMultiComment = false;
	let isEscaped = false;
	const chars: string[] = [];

	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		const next = raw[i + 1];

		if (inSingleComment) {
			if (ch === '\n' || ch === '\r') {
				inSingleComment = false;
				chars.push(ch);
			}
			continue;
		}

		if (inMultiComment) {
			if (ch === '*' && next === '/') {
				inMultiComment = false;
				i++; // skip '/'
			}
			continue;
		}

		if (inString) {
			chars.push(ch);
			if (isEscaped) {
				isEscaped = false;
			} else if (ch === '\\') {
				isEscaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}

		// Outside comments and strings
		if (ch === '"') {
			inString = true;
			isEscaped = false;
			chars.push(ch);
		} else if (ch === '/' && next === '/') {
			inSingleComment = true;
			i++;
		} else if (ch === '/' && next === '*') {
			inMultiComment = true;
			i++;
		} else {
			chars.push(ch);
		}
	}

	let cleaned = chars.join('');
	// Strip trailing commas before closing braces/brackets
	let prev: string;
	do {
		prev = cleaned;
		cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
	} while (cleaned !== prev);

	return cleaned;
}

/**
 * Resolves standard configuration file path for a given target and OS platform.
 */
export function resolveTargetConfigPath(
	target: string,
	options: {
		homeDir?: string;
		appData?: string;
		platform?: NodeJS.Platform;
	} = {},
): string {
	const platform = options.platform ?? process.platform;
	const p = platform === 'win32' ? path.win32 : path.posix;

	const home =
		options.homeDir ??
		(platform === 'win32'
			? (process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users\\Default')
			: (process.env.HOME ?? process.env.USERPROFILE ?? '/home/user'));

	const appData =
		options.appData ??
		process.env.APPDATA ??
		p.join(home, 'AppData', 'Roaming');

	const normalizedTarget = target.toLowerCase().trim();

	switch (normalizedTarget) {
		case 'cursor': {
			if (platform === 'darwin') {
				const macPrimary = p.join(
					home,
					'Library/Application Support/Cursor/User/globalStorage/cursor.mcp/mcp.json',
				);
				const macFallback = p.join(home, '.cursor/mcp.json');
				if (existsSync(macFallback) && !existsSync(macPrimary)) {
					return macFallback;
				}
				return macPrimary;
			}
			if (platform === 'win32') {
				return p.join(
					appData,
					'Cursor',
					'User',
					'globalStorage',
					'cursor.mcp',
					'mcp.json',
				);
			}
			// Linux
			return p.join(
				home,
				'.config',
				'Cursor',
				'User',
				'globalStorage',
				'cursor.mcp',
				'mcp.json',
			);
		}

		case 'claude-desktop':
		case 'claude': {
			if (platform === 'darwin') {
				return p.join(
					home,
					'Library/Application Support/Claude/claude_desktop_config.json',
				);
			}
			if (platform === 'win32') {
				return p.join(appData, 'Claude', 'claude_desktop_config.json');
			}
			return p.join(home, '.config', 'Claude', 'claude_desktop_config.json');
		}

		case 'windsurf': {
			return p.join(home, '.codeium', 'windsurf', 'mcp_config.json');
		}

		case 'antigravity': {
			return p.join(home, '.gemini', 'antigravity', 'mcp_config.json');
		}

		case 'vscode': {
			if (platform === 'darwin') {
				return p.join(home, 'Library/Application Support/Code/User/mcp.json');
			}
			if (platform === 'win32') {
				return p.join(appData, 'Code', 'User', 'mcp.json');
			}
			return p.join(home, '.config', 'Code', 'User', 'mcp.json');
		}

		default:
			throw new Error(
				`Unsupported target IDE/agent: "${target}". Supported targets: cursor, claude-desktop, windsurf, antigravity, vscode`,
			);
	}
}

/**
 * Installs or updates MCP server entry in target IDE / Agent configuration.
 */
export function installMcpServer(options: InstallOptions): InstallResult {
	const target = options.target.toLowerCase().trim();
	const configPath =
		options.configPath ??
		resolveTargetConfigPath(target, {
			homeDir: options.homeDir,
			appData: options.appData,
			platform: options.platform,
		});

	const serverName = options.serverName || 'apple-docs';
	const projectRoot = getProjectRoot();
	const defaultLauncher = resolve(projectRoot, 'bin', 'launcher.cjs');

	const command = options.command || 'node';
	const args = options.args || [defaultLauncher];

	const serverConfig: InstallServerConfig = {
		command,
		args,
		...(options.env && Object.keys(options.env).length > 0
			? { env: options.env }
			: {}),
	};

	let existingConfig: Record<string, any> = {};
	let createdNew = true;
	let updatedExisting = false;
	let backupPath: string | undefined;

	if (existsSync(configPath)) {
		createdNew = false;
		try {
			const rawContent = readFileSync(configPath, 'utf8');
			if (rawContent.trim()) {
				existingConfig = JSON.parse(cleanJsonComments(rawContent));
			}
		} catch (err) {
			if (!options.force) {
				throw new Error(
					`Failed to parse existing config at "${configPath}": ${err instanceof Error ? err.message : String(err)}. Use --force to replace.`,
				);
			}
			existingConfig = {};
		}
	}

	if (
		typeof existingConfig !== 'object' ||
		existingConfig === null ||
		Array.isArray(existingConfig)
	) {
		existingConfig = {};
	}

	if (
		!existingConfig.mcpServers ||
		typeof existingConfig.mcpServers !== 'object' ||
		Array.isArray(existingConfig.mcpServers)
	) {
		existingConfig.mcpServers = {};
	}

	if (existingConfig.mcpServers[serverName]) {
		updatedExisting = true;
	}

	existingConfig.mcpServers[serverName] = serverConfig;

	const formattedJson = `${JSON.stringify(existingConfig, null, 2)}\n`;

	if (!options.dryRun) {
		const targetDir = dirname(configPath);
		mkdirSync(targetDir, { recursive: true });

		if (!createdNew && !options.force) {
			backupPath = `${configPath}.bak`;
			try {
				copyFileSync(configPath, backupPath);
			} catch {
				// Non-fatal if backup cannot be written
				backupPath = undefined;
			}
		}

		writeFileSync(configPath, formattedJson, 'utf8');
	}

	return {
		target,
		configPath,
		createdNew,
		updatedExisting,
		serverName,
		serverConfig,
		dryRun: Boolean(options.dryRun),
		backupPath,
		configJson: formattedJson,
	};
}
