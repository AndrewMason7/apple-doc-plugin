/**
 * Retry helper for bulk provider calls.
 *
 * A single transient failure must not abort a 20k-item backfill, and it must not
 * be bypassed by a circuit breaker either: the caller retries with exponential
 * backoff and can wait out a breaker window before the next attempt.
 */
export interface RetryOptions {
	/** Total attempts, including the first one. */
	attempts: number;
	/** Delay before the first retry; doubles each attempt. */
	baseDelayMs: number;
	/** Upper bound for a single delay. */
	maxDelayMs?: number;
	/** Injectable sleep so tests do not wall-clock wait. */
	sleep?: (ms: number) => Promise<void>;
	/** Return false for errors that will never succeed (4xx other than 429). */
	shouldRetry?: (error: unknown) => boolean;
	onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions,
): Promise<T> {
	const {
		attempts,
		baseDelayMs,
		maxDelayMs = 30_000,
		sleep = defaultSleep,
		shouldRetry,
		onRetry,
	} = options;

	if (attempts < 1) {
		throw new Error('withRetry requires at least one attempt');
	}

	let lastError: unknown;

	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			const isLastAttempt = attempt === attempts - 1;
			if (isLastAttempt) break;
			if (shouldRetry && !shouldRetry(error)) break;

			const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
			onRetry?.(attempt + 1, error, delayMs);
			await sleep(delayMs);
		}
	}

	throw lastError;
}
