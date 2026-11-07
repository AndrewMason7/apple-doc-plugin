/**
 * Backwards-compatibility bridge re-exporting the root logger singleton, Logger class,
 * createLogger factory, and associated types from the modular engine in ./logger/index.js.
 */
export { logger, Logger, createLogger } from './logger/index.js';
export * from './logger/index.js';
