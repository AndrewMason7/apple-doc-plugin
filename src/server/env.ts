import { existsSync } from 'node:fs';

export interface EnvLoadResult {
	loaded: boolean;
	error?: string;
}

export function loadEnvironment(
	explicitPath?: string,
	logger: (message: string) => void = console.error,
): EnvLoadResult {
	if (typeof process.loadEnvFile !== 'function') {
		return { loaded: false };
	}

	if (explicitPath && !existsSync(explicitPath)) {
		logger('No .env found; running offline SQLite mode');
		return { loaded: false };
	}

	try {
		if (explicitPath) {
			process.loadEnvFile(explicitPath);
		} else {
			process.loadEnvFile();
		}
		return { loaded: true };
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
			logger('No .env found; running offline SQLite mode');
			return { loaded: false };
		}
		const message = err instanceof Error ? err.message : String(err);
		logger(
			`Failed to load .env: ${message}; continuing in offline SQLite mode`,
		);
		return { loaded: false, error: message };
	}
}
