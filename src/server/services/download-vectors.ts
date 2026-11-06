import { createHash } from 'node:crypto';
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import axios from 'axios';
import { AppleDocsDB } from '../db/database.js';
import { resolveDbPath } from '../db/db-path.js';
import { logger } from '../logger.js';

export const DEFAULT_VECTORS_URL =
	'https://github.com/AndrewMason7/apple-doc-plugin/releases/download/v1.0.0/apple-docs-vectors-768d.db';

export const DEFAULT_VECTORS_MIRRORS = [
	DEFAULT_VECTORS_URL,
	'https://raw.githubusercontent.com/AndrewMason7/apple-doc-plugin/main/assets/apple-docs-vectors-768d.db',
];

export interface DownloadVectorsOptions {
	dbPath?: string;
	url?: string;
	mirrors?: string[];
	expectedSha256?: string;
	force?: boolean;
	timeoutMs?: number;
	onProgress?: (progress: {
		loaded: number;
		total: number;
		percent: number;
	}) => void;
}

export interface DownloadVectorsResult {
	dbPath: string;
	sourceUrl: string;
	importedCount: number;
	totalVectors: number;
	sha256?: string;
	mode: 'hybrid' | 'lexical-only';
}

async function streamToFile(
	url: string,
	targetPath: string,
	timeoutMs: number,
	onProgress?: (progress: {
		loaded: number;
		total: number;
		percent: number;
	}) => void,
): Promise<{ bytesDownloaded: number }> {
	const response = await axios({
		method: 'GET',
		url,
		responseType: 'stream',
		headers: {
			'User-Agent': 'apple-doc-plugin/1.0.0',
		},
		timeout: timeoutMs,
	});

	const totalBytes = Number(response.headers['content-length'] || 0);
	let downloadedBytes = 0;

	const writer = createWriteStream(targetPath);

	await new Promise<void>((resolve, reject) => {
		const inactivityLimitMs = Math.min(timeoutMs, 60000);
		let timer: NodeJS.Timeout | null = null;

		const resetTimer = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				cleanup();
				reject(
					new Error(
						`Download stalled: no data received for ${inactivityLimitMs}ms`,
					),
				);
			}, inactivityLimitMs);
		};

		const cleanup = () => {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			try {
				response.data.destroy();
			} catch {}
			try {
				writer.close();
			} catch {}
		};

		resetTimer();

		response.data.on('data', (chunk: Buffer) => {
			resetTimer();
			downloadedBytes += chunk.length;
			if (onProgress) {
				const percent =
					totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
				onProgress({
					loaded: downloadedBytes,
					total: totalBytes,
					percent,
				});
			}
		});

		writer.on('finish', () => {
			if (timer) clearTimeout(timer);
			resolve();
		});
		writer.on('error', (err) => {
			cleanup();
			reject(err);
		});
		response.data.on('error', (err: unknown) => {
			cleanup();
			reject(err);
		});

		response.data.pipe(writer);
	});

	return { bytesDownloaded: downloadedBytes };
}

export async function downloadVectors(
	options: DownloadVectorsOptions = {},
): Promise<DownloadVectorsResult> {
	const dbPath = options.dbPath || resolveDbPath();
	mkdirSync(dirname(dbPath), { recursive: true });

	// If force is not requested, check whether vectors are already present
	if (!options.force && existsSync(dbPath)) {
		try {
			const checkDb = new AppleDocsDB(dbPath, { readonly: true });
			const status = checkDb.getEmbeddingStatus();
			checkDb.close();
			if (status.storageHasVectors) {
				logger.info(
					`Database at ${dbPath} already has ${status.semanticItemCount} vector items (${status.mode}). Skipping download (pass force: true to re-download).`,
				);
				return {
					dbPath,
					sourceUrl: '',
					importedCount: 0,
					totalVectors: status.semanticItemCount,
					mode: status.mode,
				};
			}
		} catch (err) {
			logger.debug(
				'Could not verify existing vectors, proceeding with download:',
				err,
			);
		}
	}

	const candidateUrls: string[] = [];
	if (options.url) {
		candidateUrls.push(options.url);
	}
	if (options.mirrors && options.mirrors.length > 0) {
		candidateUrls.push(...options.mirrors);
	}
	if (process.env.APPLE_DOCS_VECTORS_URL) {
		candidateUrls.push(process.env.APPLE_DOCS_VECTORS_URL);
	}
	if (process.env.APPLE_DOCS_VECTORS_MIRRORS) {
		const envMirrors = process.env.APPLE_DOCS_VECTORS_MIRRORS.split(',')
			.map((m) => m.trim())
			.filter(Boolean);
		candidateUrls.push(...envMirrors);
	}
	// Fall back to default mirrors if nothing specified
	if (candidateUrls.length === 0) {
		candidateUrls.push(...DEFAULT_VECTORS_MIRRORS);
	}

	// Deduplicate candidate URLs while preserving order
	const uniqueUrls = Array.from(new Set(candidateUrls));
	const timeoutMs = options.timeoutMs || 600000;
	const errors: Array<{ url: string; error: string }> = [];

	logger.info(
		`Starting vector download pipeline (${uniqueUrls.length} mirror candidates)...`,
	);
	logger.info(`Target database: ${dbPath}`);

	for (let i = 0; i < uniqueUrls.length; i++) {
		const currentUrl = uniqueUrls[i];
		const tempVectorsDb = `${dbPath}.download-vectors.${Date.now()}.${i}.tmp`;

		logger.info(
			`Attempting mirror [${i + 1}/${uniqueUrls.length}]: ${currentUrl}`,
		);

		try {
			const { bytesDownloaded } = await streamToFile(
				currentUrl,
				tempVectorsDb,
				timeoutMs,
				options.onProgress,
			);

			logger.info(`Downloaded ${bytesDownloaded} bytes from ${currentUrl}`);

			// Verify SHA-256 checksum if provided
			let actualSha256: string | undefined;
			if (options.expectedSha256) {
				const buf = readFileSync(tempVectorsDb);
				actualSha256 = createHash('sha256').update(buf).digest('hex');
				if (
					actualSha256.toLowerCase() !== options.expectedSha256.toLowerCase()
				) {
					throw new Error(
						`SHA-256 checksum mismatch: expected ${options.expectedSha256}, got ${actualSha256}`,
					);
				}
				logger.info(`SHA-256 checksum verified: ${actualSha256}`);
			} else {
				const buf = readFileSync(tempVectorsDb);
				actualSha256 = createHash('sha256').update(buf).digest('hex');
			}

			// Import into target database
			const db = new AppleDocsDB(dbPath);
			let importedCount = 0;
			let status;
			try {
				importedCount = db.importVectorsFromDb(tempVectorsDb);
				status = db.getEmbeddingStatus();
			} finally {
				db.close();
				if (existsSync(tempVectorsDb)) {
					try {
						unlinkSync(tempVectorsDb);
					} catch {}
				}
			}

			logger.info(
				`Successfully imported ${importedCount} vectors from ${currentUrl}. Total: ${status.semanticItemCount} (${status.mode})`,
			);

			return {
				dbPath,
				sourceUrl: currentUrl,
				importedCount,
				totalVectors: status.semanticItemCount,
				sha256: actualSha256,
				mode: status.mode,
			};
		} catch (err: unknown) {
			if (existsSync(tempVectorsDb)) {
				try {
					unlinkSync(tempVectorsDb);
				} catch {}
			}
			const errMsg = err instanceof Error ? err.message : String(err);
			logger.warn(`Mirror failed (${currentUrl}): ${errMsg}`);
			errors.push({ url: currentUrl, error: errMsg });
		}
	}

	const errorSummary = errors.map((e) => `  - ${e.url}: ${e.error}`).join('\n');
	throw new Error(
		`Failed to download vectors after trying ${uniqueUrls.length} mirror(s):\n${errorSummary}`,
	);
}
