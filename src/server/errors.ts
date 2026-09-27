export class AppError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly isOperational = true,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = this.constructor.name;
		Error.captureStackTrace?.(this, this.constructor);
	}
}

export class DatabaseError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 'DATABASE_ERROR', true, details);
	}
}

export class AppleDocsNetworkError extends AppError {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly isTransient = false,
		details?: unknown,
	) {
		super(message, 'NETWORK_ERROR', true, details);
	}
}

export class CacheError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 'CACHE_ERROR', true, details);
	}
}

export class ValidationError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 'VALIDATION_ERROR', true, details);
	}
}
