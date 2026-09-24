import type { FrameworkData } from '../../apple-client.js';
import type { ServerContext } from '../context.js';
export declare const loadActiveFrameworkData: ({ client, state, }: ServerContext) => Promise<FrameworkData>;
