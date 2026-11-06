import {
	createWriteStream,
	existsSync,
	mkdirSync,
	renameSync,
	unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import axios from 'axios';
import { getDefaultLocalModelPath } from './search/local-gemma-provider.js';
import { logger } from '../logger.js';

export const DEFAULT_MODEL_URL =
	'https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-Q8_0.gguf';

export interface DownloadModelOptions {
	destination?: string;
	url?: string;
	force?: boolean;
	onProgress?: (progress: {
		loaded: number;
		total: number;
		percent: number;
	}) => void;
}

export interface DownloadModelResult {
	destination: string;
	bytesDownloaded: number;
	skipped: boolean;
}

export async function downloadModel(
	options: DownloadModelOptions = {},
): Promise<DownloadModelResult> {
	const destination = options.destination || getDefaultLocalModelPath();
	const url =
		options.url || process.env.APPLE_DOCS_MODEL_URL || DEFAULT_MODEL_URL;
	const force = Boolean(options.force);

	if (existsSync(destination) && !force) {
		logger.info(
			`Local model already exists at: ${destination} (use --force to overwrite)`,
		);
		return { destination, bytesDownloaded: 0, skipped: true };
	}

	mkdirSync(dirname(destination), { recursive: true });
	const tempPath = `${destination}.download.${Date.now()}.tmp`;

	logger.info(`Downloading EmbeddingGemma model from: ${url}`);
	logger.info(`Target destination: ${destination}`);

	try {
		const response = await axios({
			method: 'GET',
			url,
			responseType: 'stream',
			headers: {
				'User-Agent': 'apple-doc-plugin/1.0.0',
			},
			timeout: 600000,
		});

		const totalBytes = Number(response.headers['content-length'] || 0);
		let downloadedBytes = 0;

		const writer = createWriteStream(tempPath);

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
			writer.on('error', (err) => {
				writer.close();
				reject(err);
			});
			response.data.on('error', (err: unknown) => {
				writer.close();
				reject(err);
			});

			response.data.pipe(writer);
		});

		renameSync(tempPath, destination);
		logger.info(
			`Successfully downloaded model to ${destination} (${downloadedBytes} bytes)`,
		);

		return {
			destination,
			bytesDownloaded: downloadedBytes,
			skipped: false,
		};
	} catch (err) {
		if (existsSync(tempPath)) {
			try {
				unlinkSync(tempPath);
			} catch {}
		}
		const msg = err instanceof Error ? err.message : String(err);
		logger.error(`Failed to download model: ${msg}`);
		throw new Error(`Failed to download local model from ${url}: ${msg}`);
	}
}
