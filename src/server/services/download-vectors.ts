import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import axios from 'axios';
import { AppleDocsDB } from '../db/database.js';
import { resolveDbPath } from '../db/db-path.js';
import { logger } from '../logger.js';

export const DEFAULT_VECTORS_URL =
	'https://github.com/AndrewMason7/apple-doc-plugin/releases/download/v1.0.0/apple-docs-vectors-768d.db';

export interface DownloadVectorsOptions {
	dbPath?: string;
	url?: string;
	force?: boolean;
	onProgress?: (progress: {
		loaded: number;
		total: number;
		percent: number;
	}) => void;
}

export interface DownloadVectorsResult {
	dbPath: string;
	importedCount: number;
	totalVectors: number;
	mode: 'hybrid' | 'lexical-only';
}

export async function downloadVectors(
	options: DownloadVectorsOptions = {},
): Promise<DownloadVectorsResult> {
	const dbPath = options.dbPath || resolveDbPath();
	const url =
		options.url || process.env.APPLE_DOCS_VECTORS_URL || DEFAULT_VECTORS_URL;

	mkdirSync(dirname(dbPath), { recursive: true });

	const tempVectorsDb = `${dbPath}.download-vectors.${Date.now()}.tmp`;

	logger.info(`Downloading pre-computed vectors from: ${url}`);
	logger.info(`Target database: ${dbPath}`);

	try {
		const response = await axios({
			method: 'GET',
			url,
			responseType: 'stream',
			headers: {
				'User-Agent': 'apple-doc-plugin/1.0.0',
			},
			timeout: 60000,
		});

		const totalBytes = Number(response.headers['content-length'] || 0);
		let downloadedBytes = 0;

		const writer = createWriteStream(tempVectorsDb);

		await new Promise<void>((resolve, reject) => {
			response.data.on('data', (chunk: Buffer) => {
				downloadedBytes += chunk.length;
				if (options.onProgress) {
					const percent =
						totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
					options.onProgress({
						loaded: downloadedBytes,
						total: totalBytes,
						percent,
					});
				}
			});

			writer.on('finish', resolve);
			writer.on('error', reject);
			response.data.on('error', reject);

			response.data.pipe(writer);
		});

		logger.info(
			`Downloaded vector package (${downloadedBytes} bytes). Importing into SQLite...`,
		);

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
			`Imported ${importedCount} vectors. Total semantic items: ${status.semanticItemCount} (${status.mode})`,
		);

		return {
			dbPath,
			importedCount,
			totalVectors: status.semanticItemCount,
			mode: status.mode,
		};
	} catch (err) {
		if (existsSync(tempVectorsDb)) {
			try {
				unlinkSync(tempVectorsDb);
			} catch {}
		}
		const msg = err instanceof Error ? err.message : String(err);
		logger.error(`Failed to download and import vectors: ${msg}`);
		throw new Error(`Failed to download vectors from ${url}: ${msg}`);
	}
}
