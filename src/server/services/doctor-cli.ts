import { AppleDocsDB } from '../db/database.js';
import type { EmbeddingProvider } from './search/embedding-provider.js';
import { formatDoctorReport, runDoctor } from './doctor.js';

export interface DoctorCliOptions {
	argv: string[];
	dbPath: string;
	provider: EmbeddingProvider;
	nodeVersion: string;
	print: (text: string) => void;
}

/** Returns the process exit code: 0 healthy, 1 failures (or warnings with --strict). */
export async function runDoctorCli(options: DoctorCliOptions): Promise<number> {
	const json = options.argv.includes('--json');
	const strict = options.argv.includes('--strict');

	let db: AppleDocsDB | undefined;
	try {
		db = new AppleDocsDB(options.dbPath, { readonly: true });
	} catch {
		db = undefined; // the database_file check reports it
	}

	try {
		const report = runDoctor({
			db,
			dbPath: options.dbPath,
			provider: options.provider,
			nodeVersion: options.nodeVersion,
		});

		options.print(
			json
				? `${JSON.stringify(report, null, 2)}\n`
				: `${formatDoctorReport(report)}\n`,
		);

		if (!report.ok) return 1;
		if (strict && report.warnings > 0) return 1;
		return 0;
	} finally {
		db?.close();
	}
}
