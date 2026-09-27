export const logger = {
	debug: (msg: string, ...args: unknown[]) => {
		if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
			console.error(`[DEBUG] ${msg}`, ...args);
		}
	},
	info: (msg: string, ...args: unknown[]) => {
		console.error(`[INFO] ${msg}`, ...args);
	},
	warn: (msg: string, ...args: unknown[]) => {
		console.error(`[WARN] ${msg}`, ...args);
	},
	error: (msg: string, ...args: unknown[]) => {
		console.error(`[ERROR] ${msg}`, ...args);
	},
};
