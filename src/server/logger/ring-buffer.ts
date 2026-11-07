import type { LogEntrySnapshot } from './types.js';

/**
 * Memory-safe circular buffer with fixed capacity storing sanitized LogEntrySnapshot records.
 * Uses FIFO eviction when buffer capacity is reached.
 */
export class LogRingBuffer {
	private buffer: (LogEntrySnapshot | undefined)[];
	private capacity: number;
	private head: number = 0;
	private tail: number = 0;
	private count: number = 0;

	constructor(capacity: number = 100) {
		const parsed = typeof capacity === 'number' ? Math.floor(capacity) : 100;
		this.capacity = Math.max(
			1,
			Math.min(Number.isNaN(parsed) ? 100 : parsed, 10000),
		);
		this.buffer = new Array(this.capacity);
	}

	/**
	 * Sanitizes a snapshot to ensure it only retains strings and compact primitives,
	 * preventing raw object references from leaking memory.
	 */
	private sanitizeSnapshot(snapshot: LogEntrySnapshot): LogEntrySnapshot {
		let sanitizedDetails: unknown = undefined;
		if (snapshot.details !== undefined && snapshot.details !== null) {
			if (typeof snapshot.details === 'object') {
				try {
					sanitizedDetails = JSON.parse(JSON.stringify(snapshot.details));
				} catch {
					sanitizedDetails = String(snapshot.details);
				}
			} else {
				sanitizedDetails = snapshot.details;
			}
		}

		return {
			timestamp:
				typeof snapshot.timestamp === 'string'
					? snapshot.timestamp
					: new Date().toISOString(),
			level: typeof snapshot.level === 'string' ? snapshot.level : 'info',
			module:
				typeof snapshot.module === 'string' && snapshot.module.length > 0
					? snapshot.module
					: undefined,
			message:
				typeof snapshot.message === 'string'
					? snapshot.message
					: String(snapshot.message ?? ''),
			details: sanitizedDetails,
		};
	}

	/**
	 * Pushes a new snapshot into the ring buffer, evicting the oldest item if at capacity.
	 */
	push(snapshot: LogEntrySnapshot): void {
		const safeSnapshot = this.sanitizeSnapshot(snapshot);
		this.buffer[this.tail] = safeSnapshot;
		this.tail = (this.tail + 1) % this.capacity;

		if (this.count < this.capacity) {
			this.count++;
		} else {
			this.head = (this.head + 1) % this.capacity;
		}
	}

	/**
	 * Retrieves recent snapshots in chronological order (oldest to newest).
	 * If count is provided, returns at most count recent items.
	 */
	getRecent(count?: number): LogEntrySnapshot[] {
		if (this.count === 0) {
			return [];
		}

		const takeCount =
			count === undefined
				? this.count
				: Math.max(0, Math.min(Math.floor(count), this.count));

		if (takeCount === 0) {
			return [];
		}

		const result: LogEntrySnapshot[] = [];
		const startIndex = (this.head + (this.count - takeCount)) % this.capacity;

		for (let i = 0; i < takeCount; i++) {
			const idx = (startIndex + i) % this.capacity;
			const item = this.buffer[idx];
			if (item) {
				result.push(item);
			}
		}

		return result;
	}

	/**
	 * Clears all entries from the buffer and releases references for garbage collection.
	 */
	clear(): void {
		for (let i = 0; i < this.capacity; i++) {
			this.buffer[i] = undefined;
		}
		this.head = 0;
		this.tail = 0;
		this.count = 0;
	}

	/**
	 * Returns current number of items stored in the ring buffer.
	 */
	size(): number {
		return this.count;
	}

	/**
	 * Returns the configured maximum capacity of the ring buffer.
	 */
	getCapacity(): number {
		return this.capacity;
	}

	/**
	 * Formats all buffered entries into a human-readable diagnostic log.
	 */
	formatDiagnostics(): string {
		const entries = this.getRecent();
		if (entries.length === 0) {
			return '';
		}

		return entries
			.map((entry) => {
				const moduleStr = entry.module ? ` [${entry.module}]` : '';
				let detailsStr = '';
				if (entry.details !== undefined && entry.details !== null) {
					try {
						detailsStr = ` ${typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)}`;
					} catch {
						detailsStr = ` ${String(entry.details)}`;
					}
				}
				return `[${entry.timestamp}] [${entry.level.toUpperCase()}]${moduleStr} ${entry.message}${detailsStr}`;
			})
			.join('\n');
	}
}
