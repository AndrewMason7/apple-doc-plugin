import { existsSync, statSync } from 'node:fs';
import { AppleDocsDB } from '../db/database.js';
import { resolveDbPath } from '../db/db-path.js';
import { getDefaultLocalModelPath } from './search/local-gemma-provider.js';
import {
	resolveEmbeddingProvider,
	UnavailableEmbeddingProvider,
} from './search/provider-factory.js';
import { downloadModel, type DownloadModelResult } from './download-model.js';
import {
	downloadVectors,
	type DownloadVectorsResult,
} from './download-vectors.js';
import { installMcpServer, type InstallResult } from './installer.js';

export interface SetupOptions {
	dbPath?: string;
	downloadVectors?: boolean;
	downloadModel?: boolean;
	target?: string;
	force?: boolean;
	dryRun?: boolean;
	onProgress?: (progress: {
		step: string;
		loaded: number;
		total: number;
		percent: number;
	}) => void;
}

export interface SetupReport {
	dbPath: string;
	dbExists: boolean;
	dbSizeMb: number;
	symbolCount: number;
	semanticItemCount: number;
	mode: 'hybrid' | 'lexical-only';
	localModelPath: string;
	localModelExists: boolean;
	localModelSizeMb: number;
	geminiApiKeyConfigured: boolean;
	geminiAuthAvailable: boolean;
	activeProviderId: string;
	activeProviderAvailable: boolean;
	vectorsDownloaded: boolean;
	modelDownloaded: boolean;
	installedTarget?: string;
	installedConfigPath?: string;
	recommendations: string[];
}

/**
 * Runs the setup inspection and optional bootstrapping steps.
 */
export async function runSetup(
	options: SetupOptions = {},
): Promise<SetupReport> {
	const dbPath = options.dbPath || resolveDbPath();
	const dbExists = existsSync(dbPath);
	let dbSizeMb = 0;
	if (dbExists) {
		try {
			dbSizeMb = Math.round((statSync(dbPath).size / 1024 / 1024) * 10) / 10;
		} catch {
			dbSizeMb = 0;
		}
	}

	let symbolCount = 0;
	let semanticItemCount = 0;

	if (dbExists) {
		try {
			const db = new AppleDocsDB(dbPath, { readonly: true });
			try {
				symbolCount = db.getSymbolCount();
				semanticItemCount = db.getSemanticItemCount();
			} finally {
				db.close();
			}
		} catch {
			// Database may be uninitialized or corrupt
			symbolCount = 0;
			semanticItemCount = 0;
		}
	}

	const localModelPath = getDefaultLocalModelPath();
	const localModelExists = existsSync(localModelPath);
	let localModelSizeMb = 0;
	if (localModelExists) {
		try {
			localModelSizeMb =
				Math.round((statSync(localModelPath).size / 1024 / 1024) * 10) / 10;
		} catch {
			localModelSizeMb = 0;
		}
	}

	const geminiApiKeyConfigured = Boolean(
		process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0,
	);

	let vectorsDownloaded = false;
	let modelDownloaded = false;
	let installedTarget: string | undefined;
	let installedConfigPath: string | undefined;

	// Execute requested bootstrap actions
	if (options.downloadVectors) {
		if (options.dryRun) {
			vectorsDownloaded = false;
		} else {
			try {
				const vecRes: DownloadVectorsResult = await downloadVectors({
					dbPath,
					force: options.force,
					onProgress: (p) => {
						options.onProgress?.({
							step: 'vectors',
							loaded: p.loaded,
							total: p.total,
							percent: p.percent,
						});
					},
				});
				vectorsDownloaded = true;
				semanticItemCount = vecRes.totalVectors;
			} catch (err) {
				throw new Error(
					`Setup failed while downloading vector assets: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	if (options.downloadModel) {
		if (options.dryRun) {
			modelDownloaded = false;
		} else {
			try {
				const modelRes: DownloadModelResult = await downloadModel({
					destination: localModelPath,
					force: options.force,
					onProgress: (p) => {
						options.onProgress?.({
							step: 'model',
							loaded: p.loaded,
							total: p.total,
							percent: p.percent,
						});
					},
				});
				modelDownloaded = !modelRes.skipped;
			} catch (err) {
				throw new Error(
					`Setup failed while downloading local model: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	if (options.target) {
		const installRes: InstallResult = installMcpServer({
			target: options.target,
			dryRun: options.dryRun,
			force: options.force,
		});
		installedTarget = installRes.target;
		installedConfigPath = installRes.configPath;
	}

	// Re-check provider after optional model download
	let provider;
	try {
		provider = resolveEmbeddingProvider();
	} catch {
		provider = new UnavailableEmbeddingProvider();
	}

	const activeProviderId = provider.id;
	const activeProviderAvailable = provider.isAvailable();
	const mode: 'hybrid' | 'lexical-only' =
		semanticItemCount >= 100 && activeProviderAvailable
			? 'hybrid'
			: 'lexical-only';

	const recommendations: string[] = [];
	if (!dbExists || symbolCount === 0) {
		recommendations.push('Build documentation index with: npm run build:index');
	}
	if (semanticItemCount < 100) {
		recommendations.push(
			'Download pre-computed 768-d vector embeddings: apple-doc-plugin download-vectors',
		);
	}
	if (!activeProviderAvailable) {
		recommendations.push(
			'Enable offline hybrid search by downloading the local model: apple-doc-plugin download-model',
		);
		recommendations.push(
			'Or set GEMINI_API_KEY in your environment for cloud embedding search',
		);
	}
	if (!installedTarget) {
		recommendations.push(
			'Configure your IDE: apple-doc-plugin install --target cursor|claude-desktop|windsurf|antigravity',
		);
	}

	const geminiAuthAvailable =
		geminiApiKeyConfigured ||
		(provider.id === 'gemini' && activeProviderAvailable);

	return {
		dbPath,
		dbExists,
		dbSizeMb,
		symbolCount,
		semanticItemCount,
		mode,
		localModelPath,
		localModelExists: existsSync(localModelPath),
		localModelSizeMb,
		geminiApiKeyConfigured,
		geminiAuthAvailable,
		activeProviderId,
		activeProviderAvailable,
		vectorsDownloaded,
		modelDownloaded,
		installedTarget,
		installedConfigPath,
		recommendations,
	};
}
