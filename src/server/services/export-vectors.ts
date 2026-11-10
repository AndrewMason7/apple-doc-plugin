import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { AppleDocsDB } from '../db/database.js';
import { ensureRuntimeDbSeeded, resolveDbPath } from '../db/db-path.js';
import { logger } from '../logger.js';

export interface ExportVectorsOptions {
	sourceDbPath?: string;
	outputPath?: string;
	writeManifest?: boolean;
	dimensions?: number;
	framework?: string;
	force?: boolean;
	onProgress?: (progress: {
		exported: number;
		total: number;
		percent: number;
	}) => void;
}

export interface VectorPackageManifest {
	formatVersion: number;
	filename: string;
	sha256: string;
	byteSize: number;
	totalVectors: number;
	dimensions: number;
	exportedAt: string;
	frameworks: string[];
}

export interface ExportVectorsResult {
	outputPath: string;
	manifestPath?: string;
	sha256Path?: string;
	sha256: string;
	totalVectors: number;
	byteSize: number;
	manifest: VectorPackageManifest;
}

export async function exportVectors(
	options: ExportVectorsOptions = {},
): Promise<ExportVectorsResult> {
	const sourceDbPath =
		options.sourceDbPath || ensureRuntimeDbSeeded() || resolveDbPath();
	const targetDimensions = options.dimensions ?? 768;
	const writeManifest = options.writeManifest !== false;

	if (!existsSync(sourceDbPath)) {
		throw new Error(`Source database does not exist at: ${sourceDbPath}`);
	}

	const defaultOutput = resolve(
		process.cwd(),
		`apple-docs-vectors-${targetDimensions}d.db`,
	);
	const outputPath = options.outputPath
		? resolve(options.outputPath)
		: defaultOutput;

	if (existsSync(outputPath) && !options.force) {
		throw new Error(
			`Target export file already exists at ${outputPath}. Use --force to overwrite.`,
		);
	}

	mkdirSync(dirname(outputPath), { recursive: true });

	const tempExportDb = `${outputPath}.export.${Date.now()}.tmp`;

	logger.info(
		`Exporting vector bundle from ${sourceDbPath} to ${outputPath}...`,
	);

	const sourceDb = new AppleDocsDB(sourceDbPath, { readonly: true });
	let allItems;
	try {
		allItems = sourceDb.getSemanticItems(options.framework);
	} finally {
		sourceDb.close();
	}

	// Filter by dimensions
	const matchingItems = allItems.filter(
		(item) => item.embedding && item.embedding.length === targetDimensions,
	);

	if (matchingItems.length === 0) {
		logger.warn(
			`No semantic items matched ${targetDimensions}-d (total items in source: ${allItems.length})`,
		);
	}

	if (existsSync(tempExportDb)) {
		try {
			unlinkSync(tempExportDb);
		} catch {}
	}

	const exportDb = new AppleDocsDB(tempExportDb);
	const frameworksSet = new Set<string>();

	try {
		let exportedCount = 0;
		const total = matchingItems.length;
		const chunkSize = 200;

		for (let i = 0; i < matchingItems.length; i += chunkSize) {
			const chunk = matchingItems.slice(i, i + chunkSize);
			exportDb.insertSemanticItems(chunk);
			for (const item of chunk) {
				frameworksSet.add(item.framework);
			}
			exportedCount += chunk.length;

			if (options.onProgress) {
				options.onProgress({
					exported: exportedCount,
					total,
					percent: total > 0 ? (exportedCount / total) * 100 : 100,
				});
			}
		}

		const exportedAt = new Date().toISOString();
		exportDb.setMeta('exported_at', exportedAt);
		exportDb.setMeta('vector_count', String(exportedCount));
		exportDb.setMeta('vector_dimensions', String(targetDimensions));
		exportDb.setMeta('format_version', '1');
		exportDb.setMeta(
			'frameworks',
			JSON.stringify(Array.from(frameworksSet).sort()),
		);

		exportDb.checkpointAndVacuum();
	} finally {
		exportDb.close();
	}

	// Move temp file to final output path
	if (existsSync(outputPath)) {
		unlinkSync(outputPath);
	}
	const { renameSync, statSync } = await import('node:fs');
	renameSync(tempExportDb, outputPath);

	// Compute SHA-256 hash
	const fileData = readFileSync(outputPath);
	const sha256 = createHash('sha256').update(fileData).digest('hex');
	const byteSize = statSync(outputPath).size;
	const exportedAt = new Date().toISOString();
	const filename = basename(outputPath);

	const manifest: VectorPackageManifest = {
		formatVersion: 1,
		filename,
		sha256,
		byteSize,
		totalVectors: matchingItems.length,
		dimensions: targetDimensions,
		exportedAt,
		frameworks: Array.from(frameworksSet).sort(),
	};

	let manifestPath: string | undefined;
	let sha256Path: string | undefined;

	if (writeManifest) {
		manifestPath = `${outputPath}.manifest.json`;
		sha256Path = `${outputPath}.sha256`;
		writeFileSync(
			manifestPath,
			JSON.stringify(manifest, null, 2) + '\n',
			'utf-8',
		);
		writeFileSync(sha256Path, `${sha256}  ${filename}\n`, 'utf-8');
	}

	logger.info(
		`Export complete: ${matchingItems.length} vectors (${byteSize} bytes, SHA-256: ${sha256.slice(0, 12)}...)`,
	);

	return {
		outputPath,
		manifestPath,
		sha256Path,
		sha256,
		totalVectors: matchingItems.length,
		byteSize,
		manifest,
	};
}
