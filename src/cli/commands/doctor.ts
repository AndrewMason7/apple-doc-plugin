import { AppleDocsDB } from '../../server/db/database.js';
import type { EmbeddingProvider } from '../../server/services/search/embedding-provider.js';
import { formatDoctorReport, runDoctor } from '../../server/services/doctor.js';

export interface DoctorCliOptions {
	argv: string[];
	dbPath: string;
	provider: EmbeddingProvider;
	nodeVersion: string;
	print: (text: string) => void;
	/** Diagnostics and usage errors. Defaults to stderr; injectable for tests. */
	eprint?: (text: string) => void;
}

const KNOWN_FLAGS = ['--json', '--strict', '--help'] as const;

const USAGE = `Usage: npm run doctor [-- --json] [-- --strict] [-- --help]

  --json     print the report as one JSON envelope on stdout
  --strict   exit 1 when there are warnings, not just failures
  --help     print this message and exit
`;

/** Exit code for a flag we do not understand: unusable, not "diagnosed". */
const EXIT_USAGE = 2;

/**
 * Returns the process exit code: 0 healthy, 1 failures (or warnings with
 * --strict), 2 unknown flags.
 */
export async function runDoctorCli(options: DoctorCliOptions): Promise<number> {
	const eprint =
		options.eprint ?? ((text: string) => process.stderr.write(text));
	const unknown = options.argv.filter(
		(arg) =>
			arg.startsWith('-') && !(KNOWN_FLAGS as readonly string[]).includes(arg),
	);
	if (unknown.length > 0) {
		// Silently ignoring a typo (`--jsn`, `--stirct`) printed a normal report
		// and exited 0, which reads as "your index is fine".
		eprint(`doctor: unknown option ${unknown.join(', ')}\n\n${USAGE}`);
		return EXIT_USAGE;
	}

	if (options.argv.includes('--help')) {
		options.print(USAGE);
		return 0;
	}

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
