import { createHash } from 'node:crypto';
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	unlinkSync,
} from 'node:fs';
import { copyFile, open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import axios from 'axios';
import { AppleDocsDB } from '../db/database.js';
import { resolveDbPath } from '../db/db-path.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Shipped vector artifact.
 *
 * The full hybrid database is ~113 MB — over GitHub's 100 MB file limit — so
 * the corpus ships as a lexical-only SQLite file and the 768-d vectors ship
 * separately, gzip-compressed (~57 MB).
 */
export const VECTOR_ARTIFACT_NAME = 'apple-docs-vectors-768d.db';
export const VECTOR_ARTIFACT_GZIP_NAME = `${VECTOR_ARTIFACT_NAME}.gz`;

/**
 * SHA-256 of the compressed artifact, verified on every install path so a
 * truncated or substituted download cannot silently produce a half-imported
 * vector layer. Update this in the same commit that regenerates the artifact.
 */
export const VECTOR_ARTIFACT_SHA256 =
	'a149456a10616291676282a17aba250c49ac6c929a88c75c80481a31135ecb86';

export const DEFAULT_VECTORS_URL = `https://raw.githubusercontent.com/AndrewMason7/apple-doc-plugin/main/assets/${VECTOR_ARTIFACT_GZIP_NAME}`;

export const DEFAULT_VECTORS_MIRRORS = [DEFAULT_VECTORS_URL];

/** Package root: `<root>/dist/server/services` -> `<root>`. */
const PACKAGE_ROOT = resolve(__dirname, '../../..');

/**
 * A repo clone or Hermes plugin install already carries the artifact under
 * `assets/`. Prefer it over the network: no download, and the width is
 * guaranteed to be the one this snapshot was built for.
 */
export function findLocalVectorArtifact(): string | undefined {
	const candidates = [
		join(PACKAGE_ROOT, 'assets', VECTOR_ARTIFACT_GZIP_NAME),
		join(PACKAGE_ROOT, 'assets', VECTOR_ARTIFACT_NAME),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

export interface DownloadVectorsOptions {
	dbPath?: string;
	url?: string;
	mirrors?: string[];
	/** Expected SHA-256 of the downloaded artifact. `null` skips verification. */
	expectedSha256?: string | null;
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

async function isGzipFile(path: string): Promise<boolean> {
	const handle = await open(path, 'r');
	try {
		const header = Buffer.alloc(2);
		await handle.read(header, 0, 2, 0);
		return header[0] === 0x1f && header[1] === 0x8b;
	} finally {
		await handle.close();
	}
}

/**
 * Return a path to a readable SQLite vector store, decompressing gzip when the
 * artifact is compressed. The returned path may be `sourcePath` itself.
 */
async function materializeVectorDb(sourcePath: string): Promise<string> {
	if (!(await isGzipFile(sourcePath))) return sourcePath;
	const outputPath = `${sourcePath}.db`;
	await pipeline(
		createReadStream(sourcePath),
		createGunzip(),
		createWriteStream(outputPath),
	);
	return outputPath;
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

	const timeoutMs = options.timeoutMs || 600000;
	const stamp = Date.now();

	const localArtifact = findLocalVectorArtifact();
	const callerUrls: string[] = [];
	if (options.url) {
		callerUrls.push(options.url);
	}
	if (options.mirrors && options.mirrors.length > 0) {
		callerUrls.push(...options.mirrors);
	}
	if (process.env.APPLE_DOCS_VECTORS_URL) {
		callerUrls.push(process.env.APPLE_DOCS_VECTORS_URL);
	}
	if (process.env.APPLE_DOCS_VECTORS_MIRRORS) {
		const envMirrors = process.env.APPLE_DOCS_VECTORS_MIRRORS.split(',')
			.map((m) => m.trim())
			.filter(Boolean);
		callerUrls.push(...envMirrors);
	}

	// Source order: the bundled artifact first (offline, exact width), then any
	// caller-supplied mirror, then the default remote mirror. Only the shipped
	// artifact carries a pinned checksum — a caller's own mirror is unverified
	// unless they explicitly pass one.
	const attempts: Array<{
		label: string;
		tempPath: string;
		pinned: boolean;
		obtain: () => Promise<number>;
	}> = [];

	// An explicitly named source always wins: never substitute the bundled
	// artifact for a URL the caller asked for. Only when the caller names
	// nothing do we prefer the bundled artifact, then the default mirror.
	if (callerUrls.length === 0 && localArtifact) {
		const tempPath = `${dbPath}.download-vectors.${stamp}.local.tmp`;
		attempts.push({
			label: `bundled artifact (${localArtifact})`,
			tempPath,
			pinned: true,
			obtain: async () => {
				await copyFile(localArtifact, tempPath);
				return statSync(tempPath).size;
			},
		});
	}

	const remoteSources: Array<{ url: string; pinned: boolean }> = [];
	for (const url of Array.from(new Set(callerUrls))) {
		remoteSources.push({ url, pinned: false });
	}
	// Fall back to the default mirror only when the caller named no source.
	if (callerUrls.length === 0) {
		for (const url of DEFAULT_VECTORS_MIRRORS) {
			remoteSources.push({ url, pinned: true });
		}
	}

	for (let i = 0; i < remoteSources.length; i++) {
		const { url, pinned } = remoteSources[i];
		const tempPath = `${dbPath}.download-vectors.${stamp}.${i}.tmp`;
		attempts.push({
			label: url,
			tempPath,
			pinned,
			obtain: () =>
				streamToFile(url, tempPath, timeoutMs, options.onProgress).then(
					({ bytesDownloaded }) => bytesDownloaded,
				),
		});
	}

	if (attempts.length === 0) {
		throw new Error(
			'No vector source available: no bundled artifact and no mirror configured. Run "npm run embed-index" to build vectors locally.',
		);
	}

	const errors: Array<{ url: string; error: string }> = [];

	logger.info(
		`Starting vector import (${attempts.length} source${attempts.length === 1 ? '' : 's'})...`,
	);
	logger.info(`Target database: ${dbPath}`);

	for (const attempt of attempts) {
		logger.info(`Attempting source: ${attempt.label}`);
		let vectorDbPath: string | undefined;
		try {
			const bytesDownloaded = await attempt.obtain();
			logger.info(`Obtained ${bytesDownloaded} bytes from ${attempt.label}`);

			// Verify the artifact before decompressing it: the sidecar SHA-256
			// published next to the artifact covers the compressed bytes a
			// caller actually receives.
			// The pinned checksum covers the shipped artifact only; a caller's
			// own mirror is verified only when they supply a checksum.
			// `expectedSha256: null` opts out of even the pinned check.
			const expectedSha256 =
				options.expectedSha256 !== undefined
					? options.expectedSha256
					: attempt.pinned
						? VECTOR_ARTIFACT_SHA256
						: null;
			const actualSha256 = createHash('sha256')
				.update(readFileSync(attempt.tempPath))
				.digest('hex');
			if (expectedSha256) {
				if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
					throw new Error(
						`SHA-256 checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`,
					);
				}
				logger.info(`SHA-256 checksum verified: ${actualSha256}`);
			}

			vectorDbPath = await materializeVectorDb(attempt.tempPath);

			const db = new AppleDocsDB(dbPath);
			let importedCount = 0;
			let status;
			try {
				importedCount = db.importVectorsFromDb(vectorDbPath);
				status = db.getEmbeddingStatus();
			} finally {
				db.close();
				for (const p of [attempt.tempPath, vectorDbPath]) {
					if (p && existsSync(p)) {
						try {
							unlinkSync(p);
						} catch {}
					}
				}
			}

			logger.info(
				`Successfully imported ${importedCount} vectors from ${attempt.label}. Total: ${status.semanticItemCount} (${status.mode})`,
			);

			return {
				dbPath,
				sourceUrl: attempt.label,
				importedCount,
				totalVectors: status.semanticItemCount,
				sha256: actualSha256,
				mode: status.mode,
			};
		} catch (err: unknown) {
			for (const p of [attempt.tempPath, vectorDbPath]) {
				if (p && existsSync(p)) {
					try {
						unlinkSync(p);
					} catch {}
				}
			}
			const errMsg = err instanceof Error ? err.message : String(err);
			logger.warn(`Source failed (${attempt.label}): ${errMsg}`);
			errors.push({ url: attempt.label, error: errMsg });
		}
	}

	const errorSummary = errors.map((e) => `  - ${e.url}: ${e.error}`).join('\n');
	throw new Error(
		`Failed to import vectors from ${attempts.length} source(s):\n${errorSummary}`,
	);
}
